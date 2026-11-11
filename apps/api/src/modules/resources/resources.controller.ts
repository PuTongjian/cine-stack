import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from '@nestjs/common'
import { tasks } from '../../app/services.js'
import { database } from '../../infrastructure/database.js'
@Controller('api')
export class ResourcesController {
  @Post('movies/:id/resource-searches') resourceSearch(
    @Param('id', ParseIntPipe) id: number
  ) {
    return tasks.createSearch(id)
  }
  @Get('resources') async resources(@Query('searchId') searchId: string) {
    if (!searchId) throw new BadRequestException('SEARCH_ID_REQUIRED')
    return database.resource.findMany({
      where: { searchId },
      orderBy: { createdAt: 'asc' },
    })
  }
  @Get('resources/:id/files') resourceFiles(
    @Param('id') id: string,
    @Query('folderId') folderId?: string
  ) {
    return tasks.resourceFiles(id, folderId)
  }
  @Get('tasks/:id/posts/:postId/resources') postResources(
    @Param('id') id: string,
    @Param('postId') postId: string
  ) {
    return tasks.postResources(id, postId)
  }
  @Post('transfers') transfer(@Body() body: any) {
    if (
      typeof body.resourceId !== 'string' ||
      !Array.isArray(body.fileIds) ||
      typeof body.folderId !== 'string'
    )
      throw new BadRequestException('INVALID_TRANSFER')
    return tasks.createTransfer(body)
  }
}
