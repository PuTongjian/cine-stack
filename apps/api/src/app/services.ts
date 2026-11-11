import { dataDir } from '../infrastructure/config.js'
import { QuarkTvService } from '../modules/integrations/quark-tv.js'
import { TmdbService } from '../modules/movies/tmdb.js'
import { StrmService } from '../modules/strm/strm.js'
import { TaskService } from '../modules/tasks/tasks.js'
export const tmdb = new TmdbService()
export const tasks = new TaskService(tmdb)
export const quarkTv = new QuarkTvService()
export const strm = new StrmService(() => tasks.quark(), dataDir, quarkTv)
tasks.strm = strm
