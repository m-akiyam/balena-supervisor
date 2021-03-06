import * as express from 'express';
import * as _ from 'lodash';

const api: express.Express & {
	balenaBackend?: {
		currentId: number;
		devices: { [key: string]: any };
		registerHandler: express.RequestHandler;
		getDeviceHandler: express.RequestHandler;
		deviceKeyHandler: express.RequestHandler;
	};
} = express();

// tslint:disable-next-line
api.use(require('body-parser').json());

api.balenaBackend = {
	currentId: 1,
	devices: {},
	registerHandler: (req, res) => {
		console.log('/device/register called with ', req.body);
		const device = req.body;
		switch (req.body.uuid) {
			case 'not-unique':
				return res.status(409).json(device);
			default:
				device.id = api.balenaBackend!.currentId++;
				api.balenaBackend!.devices[device.id] = device;
				return res.status(201).json(device);
		}
	},
	getDeviceHandler: (req, res) => {
		const uuid =
			req.query['$filter'] != null
				? req.query['$filter'].match(/uuid eq '(.*)'/)[1]
				: null;
		if (uuid != null) {
			return res.json({
				d: _.filter(api.balenaBackend!.devices, (dev) => dev.uuid === uuid),
			});
		} else {
			return res.json({ d: [] });
		}
	},
	deviceKeyHandler: (req, res) => {
		return res.status(200).send(req.body.apiKey);
	},
};

api.post('/device/register', (req, res) =>
	api.balenaBackend!.registerHandler(req, res, _.noop),
);

api.get('/v6/device', (req, res) =>
	api.balenaBackend!.getDeviceHandler(req, res, _.noop),
);

api.post('/api-key/device/:deviceId/device-key', (req, res) =>
	api.balenaBackend!.deviceKeyHandler(req, res, _.noop),
);

export = api;
