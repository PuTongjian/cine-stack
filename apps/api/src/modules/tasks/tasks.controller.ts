import { Controller, Get, Param, Post } from '@nestjs/common'
import { tasks } from '../../app/services.js'
import { database } from '../../infrastructure/database.js'
@Controller('api')
export class TasksController {
  @Get('tasks') async taskList() {
    return (
      await database.task.findMany({
        orderBy: { createdAt: 'desc' },
        take: 100,
      })
    ).map(task => tasks.publicTask(task))
  }
  @Get('tasks/:id') async task(@Param('id') id: string) {
    return tasks.publicTask(
      await database.task.findUniqueOrThrow({ where: { id } })
    )
  }
  @Post('tasks/:id/retry') retry(@Param('id') id: string) {
    return tasks.retry(id)
  }
}
