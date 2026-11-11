import { Route, Routes } from 'react-router-dom'
import { AppHeader } from '@/components/layout/app-header'
import { Discover } from '@/features/discover/pages/discover-page'
import { LibraryPage } from '@/features/library/pages/library-page'
import { MovieDetail } from '@/features/movies/pages/movie-detail-page'
import { ResourcesPage } from '@/features/resources/pages/resources-page'
import { SettingsPage } from '@/features/settings/pages/settings-page'
import { TasksPage } from '@/features/tasks/pages/tasks-page'
import { version } from '../../../../package.json'

export function AppShell() {
  return (
    <div className="app">
      <a className="skip-link" href="#main-content">
        跳到主要内容
      </a>
      <AppHeader />
      <main id="main-content" className="page-container">
        <Routes>
          <Route path="/discover" element={<Discover />} />
          <Route path="/movies/:id" element={<MovieDetail />} />
          <Route path="/movies/:id/resources" element={<ResourcesPage />} />
          <Route path="/library" element={<LibraryPage />} />
          <Route path="/tasks" element={<TasksPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Discover />} />
        </Routes>
      </main>
      <footer className="app-footer">
        <span>影栈 CineStack · v{version}</span>
        <span>电影数据来自 TMDB</span>
      </footer>
    </div>
  )
}
