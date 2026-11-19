import { HttpError } from "../errors.js";
import { createApplicationRepository } from "./repository.js";

export function createApplicationService(database) {
  const repository = createApplicationRepository(database);

  async function getOwned(id, ownerId, client = database, lock = false) {
    const application = await repository.findById(id, client, lock);
    if (!application)
      throw new HttpError(
        404,
        "application_not_found",
        "Application not found.",
      );
    if (application.owner_id !== ownerId) {
      throw new HttpError(403, "forbidden", "You do not own this application.");
    }
    return application;
  }

  return {
    create: (ownerId, input) => repository.create(ownerId, input),
    list: (ownerId, pagination) => repository.list(ownerId, pagination),
    getOwned,
    update: (id, ownerId, input) =>
      database.transaction(async (client) => {
        await getOwned(id, ownerId, client, true);
        return repository.update(id, input, client);
      }),
    remove: (id, ownerId) =>
      database.transaction(async (client) => {
        await getOwned(id, ownerId, client, true);
        await repository.remove(id, client);
      }),
  };
}
