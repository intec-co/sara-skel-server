
import { MessageService, ServiceConf } from '@Interfaces';
import path from 'path';
import { MessageChannel, Worker } from 'worker_threads';

import { MicroserviceConnection } from '../interface';

export class WorkerClient implements MicroserviceConnection {
	private readonly worker: Worker;

	constructor(service: ServiceConf) {
		const pathFile = path.join(__dirname, 'worker-server.js');
		this.worker = new Worker(pathFile, { workerData: service });
		this.worker.on('exit', error => {
			console.error(`Error: Microservice ${service.name} exit`);
			console.error(error);
		});
	}

	async send(req: MessageService): Promise<MessageService> {
		return new Promise((resolve, reject) => {
			const subChannel = new MessageChannel();
			this.worker.postMessage({ port: subChannel.port1, req }, [subChannel.port1]);
			subChannel.port2.on('message', result => {
				resolve(result);
			});
		});
	}
}
