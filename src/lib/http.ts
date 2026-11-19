import { handleError, json } from "./security";
export const found = () => json({ error: "This resource was not found." }, 404);
export async function route(action: () => Promise<Response>) { try { return await action(); } catch (error) { return handleError(error); } }
