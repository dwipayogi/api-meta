import type { Logger } from "../logger";
import type { ChangeValue, WhatsAppMessage, WhatsAppStatus } from "../types";
import type { MessageRepository } from "../db/repository";

export interface Handlers {
  handleMessage(msg: WhatsAppMessage, value: ChangeValue): Promise<void>;
  handleStatus(status: WhatsAppStatus, value: ChangeValue): Promise<void>;
}

export function createHandlers(logger: Logger, repository?: MessageRepository): Handlers {
  return {
    async handleMessage(msg, value) {
      logger.info({ id: msg.id, type: msg.type, from: msg.from }, "Pesan masuk");
      if (repository) {
        await repository.saveIncomingMessage(msg, value);
      }
    },
    async handleStatus(status, value) {
      logger.info({ id: status.id, status: status.status }, "Status pesan");
      if (repository) {
        await repository.saveStatus(status, value);
      }
    },
  };
}
