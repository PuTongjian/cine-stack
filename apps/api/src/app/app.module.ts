import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Controller, Get, Module } from '@nestjs/common'
import { rootDir } from '../infrastructure/config.js'
import { IntegrationsController } from '../modules/integrations/integrations.controller.js'
import { LibraryController } from '../modules/library/library.controller.js'
import { MoviesController } from '../modules/movies/movies.controller.js'
import { ResourcesController } from '../modules/resources/resources.controller.js'
import { StrmController } from '../modules/strm/strm.controller.js'
import { TasksController } from '../modules/tasks/tasks.controller.js'

const { version } = JSON.parse(
  readFileSync(resolve(rootDir, 'package.json'), 'utf8')
)
@Controller('api')
class HealthController {
  @Get('health') health() {
    return { status: 'ok', version }
  }
}
@Module({
  controllers: [
    HealthController,
    MoviesController,
    LibraryController,
    ResourcesController,
    TasksController,
    IntegrationsController,
    StrmController,
  ],
})
export class AppModule {}
