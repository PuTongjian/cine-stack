import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Query,
  Res,
} from '@nestjs/common'
import type { Response } from 'express'
import { tmdb } from '../../app/services.js'
import { buildNfo, movieBasename } from '../movies/metadata.js'
@Controller('api')
export class MoviesController {
  @Get('movies/trending') trending(@Query() q: any) {
    return tmdb.trending(q.window, q.page)
  }
  @Get('movies/search') search(@Query() q: any) {
    return tmdb.search(q.q, q.page, q.year)
  }
  @Get('movies/discover') discover(@Query() q: any) {
    return tmdb.discover(q)
  }
  @Get('movies/genres') genres() {
    return tmdb.get('genre/movie/list')
  }
  @Get('movies/:id') detail(@Param('id', ParseIntPipe) id: number) {
    return tmdb.detail(id)
  }
  @Get('movies/:id/nfo') async nfo(
    @Param('id', ParseIntPipe) id: number,
    @Res() res: Response
  ) {
    const movie = await tmdb.detail(id)
    res
      .type('application/xml')
      .setHeader(
        'Content-Disposition',
        `attachment; filename="movie.nfo"; filename*=UTF-8''${encodeURIComponent(movieBasename(movie) + '.nfo')}`
      )
    res.send(buildNfo(movie))
  }
}
