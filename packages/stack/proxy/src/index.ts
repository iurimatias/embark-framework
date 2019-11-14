import { Embark, Events } /* supplied by @types/embark in packages/embark-typings */ from "embark";
import { __ } from "embark-i18n";
import { buildUrl, findNextPort } from "embark-utils";
import { Logger } from 'embark-logger';
import { Proxy } from "./proxy";

const constants = require("embark-core/constants");

export default class ProxyManager {
  private readonly logger: Logger;
  private readonly events: Events;
  private wsProxy: any;
  private httpProxy: any;
  private plugins: any;
  private readonly host: string;
  private rpcPort = 0;
  private wsPort = 0;
  private ready = false;
  private isWs = false;
  private vms: any[];
  private _endpoint: string = "";
  private portsSetup: boolean = false;

  constructor(private embark: Embark, options: any) {
    this.logger = embark.logger;
    this.events = embark.events;
    this.plugins = options.plugins;
    this.vms = [];

    this.host = "localhost";

    this.events.on("blockchain:started", async (clientName: string) => {
      try {
        await this.setupProxy(clientName);

        this.ready = true;
        this.events.emit("proxy:ready");
      } catch (error) {
        this.logger.error(`Error during proxy setup: ${error.message}. Use '--loglevel debug' for more detailed information.`);
        this.logger.debug(`Error during proxy setup:\n${error.stack}`);
      }
    });
    this.events.on("blockchain:stopped", async (clientName: string, node?: string) => {
      this.ready = false;
      await this.stopProxy();
    });

    if (!this.embark.config.blockchainConfig.proxy) {
      this.logger.warn(__("The proxy has been disabled -- some Embark features will not work."));
      this.logger.warn(__("Configured wallet accounts will be ignored and cannot be used in the DApp, and transactions will not be logged."));
    }

    this.events.setCommandHandler("proxy:endpoint:get", async (cb) => {
      await this.onReady();
      cb(null, (await this.endpoint));
    });
  }

  private get endpoint() {
    return (async () => {
      if (this._endpoint) {
        return this._endpoint;
      }
      if (!this.embark.config.blockchainConfig.proxy) {
        this._endpoint = this.embark.config.blockchainConfig.endpoint;
        return this._endpoint;
      }
      await this.setupPorts();
      // TODO Check if the proxy can support HTTPS, though it probably doesn't matter since it's local
      if (this.isWs) {
        this._endpoint = buildUrl("ws", this.host, this.wsPort, "ws");
        return this._endpoint;
      }
      this._endpoint = buildUrl("http", this.host, this.rpcPort, "rpc");
      return this._endpoint;
    })();
  }

  public onReady() {
    return new Promise((resolve, _reject) => {
      if (this.ready) {
        return resolve();
      }
      this.events.once("proxy:ready", () => {
        resolve();
      });
    });
  }

  private async setupPorts() {
    if (this.portsSetup) {
      return;
    }
    const port = await findNextPort(this.embark.config.blockchainConfig.rpcPort + constants.blockchain.servicePortOnProxy);
    this.portsSetup = true;

    this.rpcPort = port;
    this.wsPort = port + 1;
    this.isWs = this.embark.config.blockchainConfig.client === constants.blockchain.vm || (/wss?/).test(this.embark.config.blockchainConfig.endpoint);
  }

  private async setupProxy(clientName: string) {
    await this.setupPorts();
    if (!this.embark.config.blockchainConfig.proxy) {
      return;
    }
    if (this.httpProxy || this.wsProxy) {
      throw new Error("Proxy is already started");
    }

    const endpoint = this.embark.config.blockchainConfig.endpoint;
    let isVm = false;

    // using simulator, ie tests
    if (clientName === constants.blockchain.vm) {
      this.isWs = true;
      isVm = true;
    }

    // HTTP
    if (clientName !== constants.blockchain.vm) {
      this.httpProxy = await new Proxy({
        endpoint,
        events: this.events,
        isWs: false,
        logger: this.logger,
        plugins: this.plugins
      })
        .serve(
          this.host,
          this.rpcPort,
        );
      this.logger.info(`HTTP Proxy for node endpoint ${this.embark.config.blockchainConfig.endpoint} listening on ${buildUrl("http", this.host, this.rpcPort, "rpc")}`);
    }
    if (this.isWs) {
      this.wsProxy = await new Proxy({
        endpoint,
        events: this.events,
        isWs: true,
        logger: this.logger,
        plugins: this.plugins,
        clientName
      })
        .serve(
          this.host,
          this.wsPort,
        );
      this.logger.info(`WS Proxy for node endpoint ${isVm ? 'vm' : endpoint} listening on ${buildUrl("ws", this.host, this.wsPort, "ws")}`);
    }
  }
  private stopProxy() {
    if (this.wsProxy) {
      this.wsProxy.stop();
      this.wsProxy = null;
    }
    if (this.httpProxy) {
      this.httpProxy.stop();
      this.httpProxy = null;
    }
  }
}
