import * as Bluebird from 'bluebird';
import * as _ from 'lodash';
import { appNotFoundMessage } from '../lib/messages';
import * as logger from '../logger';

import * as volumes from '../compose/volume-manager';

export function doRestart(applications, appId, force) {
	const { _lockingIfNecessary, deviceState } = applications;

	return _lockingIfNecessary(appId, { force }, () =>
		deviceState.getCurrentForComparison().then(function (currentState) {
			const app = safeAppClone(currentState.local.apps[appId]);
			const imageIds = _.map(app.services, 'imageId');
			applications.clearTargetVolatileForServices(imageIds);

			const stoppedApp = _.cloneDeep(app);
			stoppedApp.services = [];
			currentState.local.apps[appId] = stoppedApp;
			return deviceState
				.pausingApply(() =>
					deviceState
						.applyIntermediateTarget(currentState, { skipLock: true })
						.then(function () {
							currentState.local.apps[appId] = app;
							return deviceState.applyIntermediateTarget(currentState, {
								skipLock: true,
							});
						}),
				)
				.finally(() => deviceState.triggerApplyTarget());
		}),
	);
}

export function doPurge(applications, appId, force) {
	const { _lockingIfNecessary, deviceState } = applications;

	logger.logSystemMessage(
		`Purging data for app ${appId}`,
		{ appId },
		'Purge data',
	);
	return _lockingIfNecessary(appId, { force }, () =>
		deviceState.getCurrentForComparison().then(function (currentState) {
			if (currentState.local.apps[appId] == null) {
				throw new Error(appNotFoundMessage);
			}
			const app = safeAppClone(currentState.local.apps[appId]);

			const purgedApp = _.cloneDeep(app);
			purgedApp.services = [];
			purgedApp.volumes = {};
			currentState.local.apps[appId] = purgedApp;
			return deviceState
				.pausingApply(() =>
					deviceState
						.applyIntermediateTarget(currentState, { skipLock: true })
						.then(() => {
							// Now that we're not running anything, explicitly
							// remove the volumes, we must do this here, as the
							// application-manager will not remove any volumes
							// which are part of an active application
							return Bluebird.each(volumes.getAllByAppId(appId), (vol) =>
								vol.remove(),
							);
						})
						.then(function () {
							currentState.local.apps[appId] = app;
							return deviceState.applyIntermediateTarget(currentState, {
								skipLock: true,
							});
						}),
				)
				.finally(() => deviceState.triggerApplyTarget());
		}),
	)
		.then(() =>
			logger.logSystemMessage('Purged data', { appId }, 'Purge data success'),
		)
		.catch((err) => {
			logger.logSystemMessage(
				`Error purging data: ${err}`,
				{ appId, error: err },
				'Purge data error',
			);
			throw err;
		});
}

export function serviceAction(action, serviceId, current, target, options) {
	if (options == null) {
		options = {};
	}
	return { action, serviceId, current, target, options };
}

export function safeStateClone(targetState) {
	// We avoid using cloneDeep here, as the class
	// instances can cause a maximum call stack exceeded
	// error

	// TODO: This should really return the config as it
	// is returned from the api, but currently that's not
	// the easiest thing due to the way they are stored and
	// retrieved from the db - when all of the application
	// manager is strongly typed, revisit this. The best
	// thing to do would be to represent the input with
	// io-ts and make sure the below conforms to it

	const cloned = {
		local: {
			config: {},
		},
		dependent: {
			config: {},
		},
	};

	if (targetState.local != null) {
		cloned.local = {
			name: targetState.local.name,
			config: _.cloneDeep(targetState.local.config),
			apps: _.mapValues(targetState.local.apps, safeAppClone),
		};
	}
	if (targetState.dependent != null) {
		cloned.dependent = _.cloneDeep(targetState.dependent);
	}

	return cloned;
}

export function safeAppClone(app) {
	const containerIdForService = _.fromPairs(
		_.map(app.services, (svc) => [
			svc.serviceName,
			svc.containerId != null ? svc.containerId.substr(0, 12) : '',
		]),
	);
	return {
		appId: app.appId,
		name: app.name,
		commit: app.commit,
		releaseId: app.releaseId,
		services: _.map(app.services, (svc) => {
			// This is a bit of a hack, but when applying the target state as if it's
			// the current state, this will include the previous containerId as a
			// network alias. The container ID will be there as Docker adds it
			// implicitly when creating a container. Here, we remove any previous
			// container IDs before passing it back as target state. We have to do this
			// here as when passing it back as target state, the service class cannot
			// know that the alias being given is not in fact a user given one.
			// TODO: Make the process of moving from a current state to a target state
			// well-defined (and implemented in a seperate module)
			const svcCopy = _.cloneDeep(svc);

			_.each(svcCopy.config.networks, (net) => {
				if (Array.isArray(net.aliases)) {
					net.aliases = net.aliases.filter(
						(alias) => alias !== containerIdForService[svcCopy.serviceName],
					);
				}
			});
			return svcCopy;
		}),
		volumes: _.cloneDeep(app.volumes),
		networks: _.cloneDeep(app.networks),
	};
}
