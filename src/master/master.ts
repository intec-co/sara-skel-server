import {
	ControlData, RequestSara, SecurityData, Conf
} from '@Interfaces';
import { SecurityLayer } from './security';
import http, { IncomingMessage, Server, ServerResponse } from 'http';

import { BusLayer } from './bus';
import { loadConf } from './lib/load-conf';
import { ControlLayer } from './control';
import { Responder } from './lib/responder';
import { responses } from './lib/responses';
import { LoggerLayer } from './logger';

export class MasterSara {
	// Layers
	private readonly bus: BusLayer;
	private readonly control: ControlLayer;
	private readonly logger: LoggerLayer;
	private readonly security: SecurityLayer;
	private readonly server: Server;
	private conf: Conf;

	constructor() {
		this.security = new SecurityLayer();
		this.logger = new LoggerLayer();
		this.control = new ControlLayer();
		this.bus = new BusLayer();
		this.server = http.createServer(this.listener);
	}

	async init(confPath): Promise<void> {
		try {
			this.conf = await loadConf(confPath);
			this.control.setServices(this.conf.services);
			this.bus.initServices(this.conf, confPath);
			this.server.listen(this.conf.port, () => {
				console.log(`Master run in port: ${this.conf.port}`);
				console.log(new Date().toUTCString());
			});
		} catch (error) {
			console.error(error);
		}
	}

	private readonly listener = async (request: IncomingMessage, response: ServerResponse) => {
		const responder = new Responder(response);
		try {
			if (!this.conf.routes) {
				responses.serverError(responder);

				return;
			}
			// Communication Layer
			const req = await this.getRequest(request);
			if (!req) {
				responses.badRequest(responder);

				return;
			}

			// Security Layer
			const security: SecurityData = this.security.check(this.conf.key, req);
			if (security.isInvalid) {
				responses.unauthorized(responder, req);

				return;
			}

			// Logger Layer
			this.logger.process(req);

			// Control Layer
			const control: ControlData = this.control.process(this.conf.routes, req, security);
			if (control.isInvalid) {
				responses.forbidden(responder);

				return;
			}
			if (req.method === 'GET') {
				// Response to nginx auth
				responder.writeHead(200);
				responder.end();
			} else if (req.method === 'POST') {
				// Bus Layer
				await this.bus.process(req, control, responder);
			}
		} catch (error) {
			console.error(error);
			responses.badRequest(responder, error.error);
		}
	};

	private async getRequest(request: IncomingMessage): Promise<RequestSara> {
		return new Promise(async (resolve, reject) => {
			const headers = request.headers;
			const authorization = (headers.authorization ? headers.authorization : headers.Authorization) as string;
			let ip: string;
			if (request.headers['x-forwarded-for']) {
				ip = request.headers['x-forwarded-for'] as string;
			}
			const req: RequestSara = {
				url: request.url,
				method: request.method,
				body: undefined,
				authorization,
				ip
			};

			// Get Body on Post Request
			if (request.method === 'POST') {
				const data = [];
				request.on('data', chunk => {
					data.push(chunk);
				})
					.on('end', () => {
						try {
							const str = Buffer.concat(data)
								.toString();
							req.body = JSON.parse(str);

							resolve(req);
						} catch (error) {
							reject({ error: 'Error: incorrect body format' });
						}
					});
			} else {
				resolve(req);
			}
		});
	}
}
