import { prisma } from './src/lib/db';
prisma.task.findMany({ where: { AND: [{}, { taskType: 'project' }] } })
  .then(() => console.log('OK'))
  .catch(e => console.error(e.message))
