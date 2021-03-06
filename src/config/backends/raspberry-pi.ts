import * as _ from 'lodash';
import { fs } from 'mz';

import {
	ConfigOptions,
	DeviceConfigBackend,
	bootMountPoint,
	remountAndWriteAtomic,
} from './backend';
import * as constants from '../../lib/constants';
import log from '../../lib/supervisor-console';

/**
 * A backend to handle Raspberry Pi host configuration
 *
 * Supports:
 * 	- {BALENA|RESIN}_HOST_CONFIG_dtparam = value | "value" | "value1","value2"
 * 	- {BALENA|RESIN}_HOST_CONFIG_dtoverlay = value | "value" | "value1","value2"
 * 	- {BALENA|RESIN}_HOST_CONFIG_device_tree_param = value | "value" | "value1","value2"
 * 	- {BALENA|RESIN}_HOST_CONFIG_device_tree_overlay = value | "value" | "value1","value2"
 * 	- {BALENA|RESIN}_HOST_CONFIG_gpio = value | "value" | "value1","value2"
 */

export class RPiConfigBackend extends DeviceConfigBackend {
	private static bootConfigVarPrefix = `${constants.hostConfigVarPrefix}CONFIG_`;
	private static bootConfigPath = `${bootMountPoint}/config.txt`;

	public static bootConfigVarRegex = new RegExp(
		'(?:' + _.escapeRegExp(RPiConfigBackend.bootConfigVarPrefix) + ')(.+)',
	);

	private static arrayConfigKeys = [
		'dtparam',
		'dtoverlay',
		'device_tree_param',
		'device_tree_overlay',
		'gpio',
	];
	private static forbiddenConfigKeys = [
		'disable_commandline_tags',
		'cmdline',
		'kernel',
		'kernel_address',
		'kernel_old',
		'ramfsfile',
		'ramfsaddr',
		'initramfs',
		'device_tree_address',
		'init_emmc_clock',
		'avoid_safe_mode',
	];

	public async matches(deviceType: string): Promise<boolean> {
		return deviceType.startsWith('raspberry') || deviceType === 'fincm3';
	}

	public async getBootConfig(): Promise<ConfigOptions> {
		let configContents = '';

		if (await fs.exists(RPiConfigBackend.bootConfigPath)) {
			configContents = await fs.readFile(
				RPiConfigBackend.bootConfigPath,
				'utf-8',
			);
		} else {
			await fs.writeFile(RPiConfigBackend.bootConfigPath, '');
		}

		const conf: ConfigOptions = {};
		const configStatements = configContents.split(/\r?\n/);

		for (const configStr of configStatements) {
			// Don't show warnings for comments and empty lines
			const trimmed = _.trimStart(configStr);
			if (trimmed.startsWith('#') || trimmed === '') {
				continue;
			}
			let keyValue = /^([^=]+)=(.*)$/.exec(configStr);
			if (keyValue != null) {
				const [, key, value] = keyValue;
				if (!RPiConfigBackend.arrayConfigKeys.includes(key)) {
					conf[key] = value;
				} else {
					if (conf[key] == null) {
						conf[key] = [];
					}
					const confArr = conf[key];
					if (!Array.isArray(confArr)) {
						throw new Error(
							`Expected '${key}' to have a config array but got ${typeof confArr}`,
						);
					}
					confArr.push(value);
				}
				continue;
			}

			// Try the next regex instead
			keyValue = /^(initramfs) (.+)/.exec(configStr);
			if (keyValue != null) {
				const [, key, value] = keyValue;
				conf[key] = value;
			} else {
				log.warn(`Could not parse config.txt entry: ${configStr}. Ignoring.`);
			}
		}

		return conf;
	}

	public async setBootConfig(opts: ConfigOptions): Promise<void> {
		const confStatements = _.flatMap(opts, (value, key) => {
			if (key === 'initramfs') {
				return `${key} ${value}`;
			} else if (Array.isArray(value)) {
				return value.map((entry) => `${key}=${entry}`);
			} else {
				return `${key}=${value}`;
			}
		});
		const confStr = `${confStatements.join('\n')}\n`;
		await remountAndWriteAtomic(RPiConfigBackend.bootConfigPath, confStr);
	}

	public isSupportedConfig(configName: string): boolean {
		return !RPiConfigBackend.forbiddenConfigKeys.includes(configName);
	}

	public isBootConfigVar(envVar: string): boolean {
		return envVar.startsWith(RPiConfigBackend.bootConfigVarPrefix);
	}

	public processConfigVarName(envVar: string): string {
		return envVar.replace(RPiConfigBackend.bootConfigVarRegex, '$1');
	}

	public processConfigVarValue(key: string, value: string): string | string[] {
		if (RPiConfigBackend.arrayConfigKeys.includes(key)) {
			if (!value.startsWith('"')) {
				return [value];
			} else {
				return JSON.parse(`[${value}]`);
			}
		}
		return value;
	}

	public createConfigVarName(configName: string): string {
		return RPiConfigBackend.bootConfigVarPrefix + configName;
	}
}
