const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
prisma.task.findMany({ where: { AND: [{}, { taskType: 'project' }] } })
  .then(() => console.log('OK'))
  .catch(e => console.error(e.message))
  .finally(() => prisma.$disconnect());
