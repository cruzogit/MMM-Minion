import { buildTaskWhere } from "./src/lib/tasks/rules";

const params = { type: "project", view: "ongoing" };
const scope = { all: false, me: "emp1", people: ["emp1"] };
const now = new Date();
const where = buildTaskWhere(params, scope, now, undefined, new Map());
console.dir(where, { depth: null });
