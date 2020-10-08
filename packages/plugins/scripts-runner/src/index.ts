import {
  InitializationError,
  UnsupportedTargetError,
  ScriptExecutionError,
  ScriptTrackingError
} from './error';

import { FileSystemTracker, ScriptsTracker, TrackingData } from './tracker';

import AsyncIterator from 'core-js-pure/features/async-iterator';
import { Embark, Callback } from 'embark-core';
import { __ } from 'embark-i18n';
import { Logger } from 'embark-logger';
import { dappPath } from 'embark-utils';
import * as fs from 'fs-extra';
import path from 'path';
import Web3 from "web3";
import { BlockTransactionObject } from 'web3-eth';

export enum ScriptsRunnerCommand {
  Initialize = 'scripts-runner:initialize',
  Execute = 'scripts-runner:execute'
}

export enum ScriptsRunnerEvent {
  Executed = 'scripts-runner:script:executed'
}

export interface ScriptsRunnerPluginOptions {
  tracker?: ScriptsTracker;
}

export interface ScriptDependencies {
  web3: Web3 | null;
  contracts: any;
  logger: Logger;
}

export interface ExecuteOptions {
  target: string;
  dependencies: ScriptDependencies;
  forceTracking: boolean;
}

export default class ScriptsRunnerPlugin {

  private _web3: Web3 | null = null;

  private _block: BlockTransactionObject | null = null;

  private trackingEnabled: boolean;

  private tracker: ScriptsTracker;

  constructor(private embark: Embark, options?: ScriptsRunnerPluginOptions) {
    this.tracker = options?.tracker ? options.tracker : new FileSystemTracker(embark);
    this.trackingEnabled = embark.config.contractsConfig.tracking !== false;

    // TODO: it'd be wonderful if Embark called `registerCommandHandlers()` for us
    this.registerCommandHandlers();
  }

  private registerCommandHandlers() {
    this.embark.events.setCommandHandler(ScriptsRunnerCommand.Initialize, this.initialize.bind(this));
    this.embark.events.setCommandHandler(ScriptsRunnerCommand.Execute, this.execute.bind(this));
  }

  private async initialize(callback: Callback<any>) {
    if (!this.trackingEnabled) {
      return callback();
    }
    try {
      await this.tracker.ensureTrackingFile();
      callback();
    } catch (e) {
      callback(new InitializationError(e));
    }
  }

  private get web3() {
    return (async () => {
      if (!this._web3) {
        const provider = await this.embark.events.request2('blockchain:client:provider', 'ethereum');
        this._web3 = new Web3(provider);
      }
      return this._web3;
    })();
  }

  private async execute(target: string, forceTracking = false, callback: Callback<any>) {
    const targetPath = !path.isAbsolute(target) ? dappPath(target) : target;
    try {
      const fstat = await fs.stat(targetPath);
      if (fstat.isDirectory()) {
        const dependencies = await this.getScriptDependencies();
        const results = await this.executeAll({ target: targetPath, dependencies, forceTracking });
        return callback(null, results);
      }
      if (fstat.isFile()) {
        const dependencies = await this.getScriptDependencies();
        const result = await this.executeSingle({ target: targetPath, dependencies, forceTracking });
        return callback(null, result);
      }
      callback(new UnsupportedTargetError(fstat));
    } catch (e) {
      callback(e);
    }
  }

  private async executeSingle(options: ExecuteOptions) {
    const forceTracking = options.forceTracking;
    const scriptName = path.basename(options.target);
    const scriptDirectory = path.basename(path.dirname(options.target));
    const scriptTracked = await this.tracker.isTracked(scriptName);

    if (scriptTracked && (scriptDirectory === this.embark.config.embarkConfig.migrations || forceTracking)) {
      this.embark.logger.info(__('  ✓ %s already done', scriptName));
      return;
    }

    this.embark.logger.info(__('  %s running....', scriptName));
    const scriptToRun = require(options.target);

    let result;

    try {
      result = await scriptToRun(options.dependencies);
    } catch (e) {
      const error = e instanceof Error ? e : new Error(e);
      throw new ScriptExecutionError(options.target, error);
    }

    this.embark.logger.info(__('  ✓ finished.'));

    if (!this.trackingEnabled) {
      return result;
    }

    try {
      await this.tracker.track({
        scriptName,
        scriptDirectory,
        forceTracking
      });
    } catch (e) {
      const error = e instanceof Error ? e : new Error(e);
      throw new ScriptTrackingError(e);
    }
    return result;
  }

  private async executeAll(options: ExecuteOptions) {
    const target = options.target;
    const files = await fs.readdir(target);

    const scripts = await Promise.all(
      files.map(async file => {
        const targetPath = !path.isAbsolute(target) ? dappPath(target, file) : path.join(target, file);
        return { target: targetPath, stats: await fs.stat(targetPath) };
      })
    );

    return AsyncIterator.from(scripts)
      .filter(({stats}) => stats.isFile())
      .map(fstat => ({
        target: fstat.target,
        dependencies: options.dependencies,
        forceTracking: options.forceTracking
      }))
      .map(script => this.executeSingle(script))
      .toArray();
  }

  private async getScriptDependencies() {
    const contracts = await this.embark.events.request2('contracts:list');

    const dependencies: ScriptDependencies  = {
      logger:  this.embark.logger,
      web3: null,
      contracts: {}
    };

    dependencies.web3 = await this.web3;

    const accounts = await dependencies.web3.eth.getAccounts();
    dependencies.web3.eth.defaultAccount = accounts[0];

    for (const contract of contracts) {
      const registeredInVM = this.checkContractRegisteredInVM(contract);
      if (!registeredInVM) {
        await this.embark.events.request2("embarkjs:contract:runInVm", contract);
      }
      const contractInstance = await this.embark.events.request2("runcode:eval", contract.className);
      dependencies.contracts[contract.className] = contractInstance;
    }
    return dependencies;
  }

  private async checkContractRegisteredInVM(contract) {
    const checkContract = `
      return typeof ${contract.className} !== 'undefined';
    `;
    return this.embark.events.request2('runcode:eval', checkContract);
  }
}
