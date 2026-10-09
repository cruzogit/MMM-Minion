import { prisma } from './src/lib/db';
prisma.task.findMany({
  where: {
    AND: [
      {},
      { taskType: 'project' },
      {
        AND: [
          { status: { notIn: ['Completed', 'Verified', 'Closed'] } },
          {},
          {
            OR: [
              { startDate: null },
              { startDate: { lte: new Date() } }
            ]
          }
        ]
      }
    ]
  }
})
  .then(() => console.log('OK'))
  .catch(e => console.error(e.message))
