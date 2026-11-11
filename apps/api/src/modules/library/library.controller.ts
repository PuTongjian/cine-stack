import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Put,
  Query,
} from '@nestjs/common'
import { tasks } from '../../app/services.js'
import { database } from '../../infrastructure/database.js'
import { findDownloadedMovieIds } from '../library/library.js'
@Controller('api')
export class LibraryController {
  @Get('library') async library(@Query() q: any) {
    const movies = await database.movie.findMany({
      orderBy: { updatedAt: 'desc' },
    })
    const downloaded =
      process.env.QUARK_COOKIE && process.env.QUARK_LIBRARY_FOLDER_ID
        ? await findDownloadedMovieIds(
            movies.map(movie => JSON.parse(movie.metadata)),
            folderId => tasks.quark().listFiles(folderId),
            process.env.QUARK_LIBRARY_FOLDER_ID
          )
        : new Set<number>()
    return {
      results: movies
        .filter(
          m =>
            (q.watched !== 'true' || m.watchedAt) &&
            (q.downloaded !== 'true' || downloaded.has(m.id))
        )
        .map(m => ({
          ...JSON.parse(m.metadata),
          watchedAt: m.watchedAt,
          rating: m.rating,
          downloaded: downloaded.has(m.id),
        })),
    }
  }
  @Put('library/:id') async add(@Param('id', ParseIntPipe) id: number) {
    await tasks.saveMovie(id)
    return { id }
  }
  @Patch('library/:id') async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: any
  ) {
    if (body.watched !== undefined && typeof body.watched !== 'boolean')
      throw new BadRequestException('INVALID_WATCHED')
    if (
      body.rating !== undefined &&
      body.rating !== null &&
      (typeof body.rating !== 'number' || body.rating < 0 || body.rating > 10)
    )
      throw new BadRequestException('INVALID_RATING')
    await tasks.saveMovie(id)
    return database.movie.update({
      where: { id },
      data: {
        ...(body.watched !== undefined
          ? { watchedAt: body.watched ? new Date() : null }
          : {}),
        ...(body.rating !== undefined ? { rating: body.rating } : {}),
      },
    })
  }
}
