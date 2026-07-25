import {
  Client,
  Account,
  TablesDB,
  Storage,
  Functions,
  Realtime,
  Channel,
  ID,
  Query,
  Permission,
  Role,
} from "appwrite";
import { APPWRITE_IDS } from "../types/shiftproof";

const endpoint =
  import.meta.env.VITE_APPWRITE_ENDPOINT ?? APPWRITE_IDS.endpoint;
const projectId =
  import.meta.env.VITE_APPWRITE_PROJECT_ID ?? APPWRITE_IDS.projectId;

const client = new Client().setEndpoint(endpoint).setProject(projectId);

export const account = new Account(client);
export const tables = new TablesDB(client);
export const storage = new Storage(client);
export const functions = new Functions(client);
export const realtime = new Realtime(client);

export const DB = APPWRITE_IDS.databaseId;
export { ID, Query, Permission, Role, client, Channel };
