import { admin } from "./admin";
import { auth } from "./auth";
import { staff } from "./staff";
import { bookings, facilities, me, waitlist } from "./student";

/** Everything the app can call. The HTTP layer exposes these by `namespace.method`. */
export const api = { auth, facilities, bookings, waitlist, me, staff, admin };

export type Api = typeof api;
