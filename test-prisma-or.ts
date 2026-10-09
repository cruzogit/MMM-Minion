import { prisma } from './src/lib/db';
prisma.task.findMany({
  where: {
    AND: [
      {
        OR: [
          { assigneeId: { in: [ "emp1" ] } },
          { assignedByEmployeeId: { in: [ "emp1" ] } }
        ]
      },
      { taskType: 'project' }
    ]
  }
})
  .then(() => console.log('OK'))
  .catch(e => console.error(e.message))
