import { prisma } from './src/lib/db';
prisma.task.findMany({
  where: {
    AND: [
      0 as any,
      { taskType: 'project' }
    ]
  }
})
  .then(() => console.log('OK'))
  .catch(e => console.error(e.message))
