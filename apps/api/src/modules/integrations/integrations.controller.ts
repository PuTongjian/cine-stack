import { Controller, Get, Post } from '@nestjs/common'
import { quarkTv, tasks } from '../../app/services.js'
@Controller('api')
export class IntegrationsController {
  @Get('integrations') integrations() {
    return {
      tmdb: !!(process.env.TMDB_API_KEY || process.env.TMDB_READ_ACCESS_TOKEN),
      suenen: !!(process.env.SUENEN_USERNAME && process.env.SUENEN_PASSWORD),
      quark: !!process.env.QUARK_COOKIE,
      folderId: process.env.QUARK_LIBRARY_FOLDER_ID || null,
      folderName: process.env.QUARK_LIBRARY_FOLDER_NAME || 'MovieLibrary',
      engine: 'CloudSaver MIT adapter',
      metadataUpload: true,
    }
  }
  @Post('integrations/quark/check') async checkQuark() {
    return {
      connected: true,
      count: (
        await tasks.quark().listFiles(process.env.QUARK_LIBRARY_FOLDER_ID)
      ).length,
    }
  }
  @Get('integrations/quark-tv') quarkTvStatus() {
    return quarkTv.status()
  }
  @Post('integrations/quark-tv/login') quarkTvLogin() {
    return quarkTv.startLogin()
  }
  @Post('integrations/quark-tv/poll') quarkTvPoll() {
    return quarkTv.pollLogin()
  }
  @Post('integrations/quark-tv/logout') quarkTvLogout() {
    return quarkTv.logout()
  }
}
