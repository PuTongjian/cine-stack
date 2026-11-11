import {
  Compass,
  Film,
  Library,
  ListChecks,
  Menu,
  Search,
  Settings,
} from 'lucide-react'
import { Link, NavLink } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ThemeToggle } from './theme-toggle'

const navigation = [
  { icon: Compass, path: '/discover', label: '发现电影' },
  { icon: Library, path: '/library', label: '我的片库' },
  { icon: ListChecks, path: '/tasks', label: '任务记录' },
  { icon: Settings, path: '/settings', label: '连接设置' },
]
export function AppHeader() {
  return (
    <header className="app-header">
      <div className="header-start">
        <Link className="brand" to="/discover" aria-label="影栈首页">
          <Film size={24} />
          <span>影栈</span>
        </Link>
        <nav className="desktop-nav" aria-label="主要导航">
          {navigation.map(({ icon: Icon, path, label }) => (
            <NavLink key={path} to={path}>
              <Icon size={14} />
              {label}
            </NavLink>
          ))}
        </nav>
      </div>
      <div className="header-actions">
        <Button asChild variant="outline" className="header-search">
          <Link to="/discover?mode=search">
            <Search size={15} />
            <span>搜索电影</span>
          </Link>
        </Button>
        <ThemeToggle />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              className="mobile-menu lg:hidden"
              aria-label="打开导航菜单"
            >
              <Menu size={19} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuLabel>电影管理</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {navigation.map(({ icon: Icon, path, label }) => (
              <DropdownMenuItem key={path} asChild>
                <NavLink to={path} className="gap-2">
                  <Icon size={15} />
                  {label}
                </NavLink>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
