import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

type FilterProps = {
  id: string
  label: string
  value: string
  options: { value: string; label: string }[]
  onChange: (value: string) => void
}
export function CatalogFilter({
  id,
  label,
  value,
  options,
  onChange,
}: FilterProps) {
  return (
    <div className="filter-field">
      <label htmlFor={id}>{label}</label>
      <Select
        value={value || 'any'}
        onValueChange={next => onChange(next === 'any' ? '' : next)}
      >
        <SelectTrigger id={id}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map(option => (
            <SelectItem
              key={option.value || 'any'}
              value={option.value || 'any'}
            >
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
