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
import { strm, tasks } from '../../app/services.js'
import { database } from '../../infrastructure/database.js'
import { movieFolder } from '../movies/metadata.js'
import { findDownloadedMovieIds, movieIdForFolder } from './library.js'
@Controller('api')
export class LibraryController {
  @Get('library') async library(@Query() q: any) {
    const movies = await database.movie.findMany({
      orderBy: { updatedAt: 'desc' },
    })
    const details = movies.map(movie => JSON.parse(movie.metadata))
    const moviesByFolder = new Map(
      details.map(movie => [movieFolder(movie), movie.id as number])
    )
    // Status comes from the drive and the STRM directory themselves, never from task history.
    const [downloaded, mapped] = await Promise.all([
      process.env.QUARK_COOKIE && process.env.QUARK_LIBRARY_FOLDER_ID
        ? findDownloadedMovieIds(
            details,
            folderId => tasks.quark().listFiles(folderId),
            process.env.QUARK_LIBRARY_FOLDER_ID
          )
        : new Set<number>(),
      strm.strmMovieIds(name => movieIdForFolder(name, moviesByFolder)),
    ])
    const entries = movies.map(movie => ({
      ...JSON.parse(movie.metadata),
      watchedAt: movie.watchedAt,
      rating: movie.rating,
    }))
    const knownIds = new Set(movies.map(movie => movie.id))
    // Files can outlive their database row; discover them before applying library filters.
    for (const id of new Set([...downloaded, ...mapped])) {
      if (knownIds.has(id)) continue
      let movie
      try {
        movie = await tasks.saveMovie(id)
      } catch (error) {
        if (!(error instanceof Error) || !error.message.startsWith('TMDB_'))
          throw error
        // Keep actual file presence visible while metadata is unavailable; retry on the next read.
        movie = {
          id,
          title: `TMDB ${id}`,
          release_date: '',
          poster_path: null,
          vote_average: 0,
          overview: '电影文件已存在，暂时无法获取电影信息。',
        }
      }
      entries.push({ ...movie, watchedAt: null, rating: null })
    }
    return {
      results: entries
        .filter(
          m =>
            (q.watched !== 'true' || m.watchedAt) &&
            (q.downloaded !== 'true' || downloaded.has(m.id))
        )
        .map(m => ({
          ...m,
          downloaded: downloaded.has(m.id),
          strm: mapped.has(m.id),
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
