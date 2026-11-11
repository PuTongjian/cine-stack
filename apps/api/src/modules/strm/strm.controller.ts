import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
} from '@nestjs/common'
import type { Request, Response } from 'express'
import { strm } from '../../app/services.js'
@Controller('api')
export class StrmController {
  @Get('strm/settings') strmSettings() {
    return strm.getSettings()
  }
  @Put('strm/settings') saveStrmSettings(@Body() body: unknown) {
    return strm.saveSettings(body)
  }
  @Get('strm/folders') strmFolders(@Query('folderId') folderId?: string) {
    return strm.folders(folderId)
  }
  @Post('strm/sync') syncStrm() {
    return strm.sync()
  }
  @Get('strm/stream/:id') stream(
    @Param('id') id: string,
    @Req() req: Request,
    @Res() res: Response
  ) {
    return strm.stream(id, req, res)
  }
}
