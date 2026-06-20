'use client';

import { useState, useRef, useEffect } from 'react';
import { Calendar, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { format, startOfMonth, endOfMonth, startOfYear, endOfYear, subMonths, subDays, addMonths, isSameDay, isWithinInterval, isBefore, isAfter } from 'date-fns';
import { cn } from '@/lib/utils';

interface DateRange {
  startDate: Date | null;
  endDate: Date | null;
}

interface DateRangePickerProps {
  value: DateRange;
  onChange: (range: DateRange) => void;
  className?: string;
}

// Preset date ranges
const presets = [
  { label: 'Today', getValue: () => ({ startDate: new Date(), endDate: new Date() }) },
  { label: 'Yesterday', getValue: () => ({ startDate: subDays(new Date(), 1), endDate: subDays(new Date(), 1) }) },
  { label: 'Last 7 days', getValue: () => ({ startDate: subDays(new Date(), 6), endDate: new Date() }) },
  { label: 'Last 30 days', getValue: () => ({ startDate: subDays(new Date(), 29), endDate: new Date() }) },
  { label: 'This month', getValue: () => ({ startDate: startOfMonth(new Date()), endDate: new Date() }) },
  { label: 'Last month', getValue: () => ({ startDate: startOfMonth(subMonths(new Date(), 1)), endDate: endOfMonth(subMonths(new Date(), 1)) }) },
  { label: 'This year', getValue: () => ({ startDate: startOfYear(new Date()), endDate: new Date() }) },
  { label: 'All time', getValue: () => ({ startDate: null, endDate: null }) },
];

// Calendar component
function CalendarMonth({
  month,
  selectedRange,
  hoverDate,
  onDateClick,
  onDateHover,
  onMonthChange,
  showNavigation = true,
}: {
  month: Date;
  selectedRange: DateRange;
  hoverDate: Date | null;
  onDateClick: (date: Date) => void;
  onDateHover: (date: Date | null) => void;
  onMonthChange: (direction: 'prev' | 'next') => void;
  showNavigation?: boolean;
}) {
  const daysOfWeek = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
  const firstDayOfMonth = startOfMonth(month);
  const lastDayOfMonth = endOfMonth(month);
  const startDay = firstDayOfMonth.getDay();
  const daysInMonth = lastDayOfMonth.getDate();

  const days: (Date | null)[] = [];

  // Add empty cells for days before the first day of the month
  for (let i = 0; i < startDay; i++) {
    days.push(null);
  }

  // Add all days of the month
  for (let i = 1; i <= daysInMonth; i++) {
    days.push(new Date(month.getFullYear(), month.getMonth(), i));
  }

  const isSelected = (date: Date) => {
    if (!date) return false;
    if (selectedRange.startDate && isSameDay(date, selectedRange.startDate)) return true;
    if (selectedRange.endDate && isSameDay(date, selectedRange.endDate)) return true;
    return false;
  };

  const isInRange = (date: Date) => {
    if (!date || !selectedRange.startDate) return false;

    const endDate = selectedRange.endDate || hoverDate;
    if (!endDate) return false;

    const start = isBefore(selectedRange.startDate, endDate) ? selectedRange.startDate : endDate;
    const end = isAfter(selectedRange.startDate, endDate) ? selectedRange.startDate : endDate;

    return isWithinInterval(date, { start, end });
  };

  const isToday = (date: Date) => {
    return date && isSameDay(date, new Date());
  };

  return (
    <div className="p-3">
      {/* Month header */}
      <div className="flex items-center justify-between mb-2">
        {showNavigation ? (
          <button
            onClick={() => onMonthChange('prev')}
            className="p-1 hover:bg-gray-100 rounded"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
        ) : (
          <div className="w-6" />
        )}
        <span className="text-sm font-medium">
          {format(month, 'MMMM yyyy')}
        </span>
        {showNavigation ? (
          <button
            onClick={() => onMonthChange('next')}
            className="p-1 hover:bg-gray-100 rounded"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        ) : (
          <div className="w-6" />
        )}
      </div>

      {/* Days of week */}
      <div className="grid grid-cols-7 gap-1 mb-1">
        {daysOfWeek.map((day) => (
          <div key={day} className="text-center text-xs text-gray-500 font-medium py-1">
            {day}
          </div>
        ))}
      </div>

      {/* Calendar days */}
      <div className="grid grid-cols-7 gap-1">
        {days.map((date, index) => (
          <div key={index} className="aspect-square">
            {date ? (
              <button
                onClick={() => onDateClick(date)}
                onMouseEnter={() => onDateHover(date)}
                onMouseLeave={() => onDateHover(null)}
                className={cn(
                  'w-full h-full text-sm rounded-md flex items-center justify-center transition-colors',
                  isSelected(date) && 'bg-blue-600 text-white',
                  !isSelected(date) && isInRange(date) && 'bg-blue-100',
                  !isSelected(date) && !isInRange(date) && 'hover:bg-gray-100',
                  isToday(date) && !isSelected(date) && 'ring-1 ring-blue-600',
                )}
              >
                {date.getDate()}
              </button>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function DateRangePicker({ value, onChange, className }: DateRangePickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [hoverDate, setHoverDate] = useState<Date | null>(null);
  const [selectingEnd, setSelectingEnd] = useState(false);
  const [tempRange, setTempRange] = useState<DateRange>(value);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Sync temp range with value
  useEffect(() => {
    setTempRange(value);
  }, [value]);

  const handleDateClick = (date: Date) => {
    if (!selectingEnd || !tempRange.startDate) {
      // Start new selection
      setTempRange({ startDate: date, endDate: null });
      setSelectingEnd(true);
    } else {
      // Complete selection
      let start = tempRange.startDate;
      let end = date;

      // Ensure start is before end
      if (isAfter(start, end)) {
        [start, end] = [end, start];
      }

      setTempRange({ startDate: start, endDate: end });
      onChange({ startDate: start, endDate: end });
      setSelectingEnd(false);
      setIsOpen(false);
    }
  };

  const handlePresetClick = (preset: typeof presets[0]) => {
    const range = preset.getValue();
    setTempRange(range);
    onChange(range);
    setIsOpen(false);
  };

  const handleClear = () => {
    setTempRange({ startDate: null, endDate: null });
    onChange({ startDate: null, endDate: null });
    setIsOpen(false);
  };

  const formatDisplayValue = () => {
    if (!value.startDate && !value.endDate) {
      return 'All time';
    }
    if (value.startDate && value.endDate) {
      if (isSameDay(value.startDate, value.endDate)) {
        return format(value.startDate, 'MMM d, yyyy');
      }
      return `${format(value.startDate, 'MMM d, yyyy')} - ${format(value.endDate, 'MMM d, yyyy')}`;
    }
    if (value.startDate) {
      return `From ${format(value.startDate, 'MMM d, yyyy')}`;
    }
    return 'Select date range';
  };

  const nextMonth = addMonths(currentMonth, 1);

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      {/* Trigger button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          'flex items-center gap-2 px-3 py-2 text-sm border border-gray-300 rounded-md bg-white hover:bg-gray-50',
          'focus:outline-none focus:ring-2 focus:ring-blue-500',
          isOpen && 'ring-2 ring-blue-500'
        )}
      >
        <Calendar className="w-4 h-4 text-gray-500" />
        <span className="text-gray-700">{formatDisplayValue()}</span>
        {(value.startDate || value.endDate) && (
          <X
            className="w-4 h-4 text-gray-400 hover:text-gray-600"
            onClick={(e) => {
              e.stopPropagation();
              handleClear();
            }}
          />
        )}
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div className="absolute top-full left-0 mt-1 bg-white rounded-lg shadow-lg border border-gray-200 z-50">
          <div className="flex">
            {/* Presets */}
            <div className="border-r border-gray-200 p-2 w-36">
              <div className="text-xs font-medium text-gray-500 px-2 py-1 mb-1">Quick select</div>
              {presets.map((preset) => (
                <button
                  key={preset.label}
                  onClick={() => handlePresetClick(preset)}
                  className="w-full text-left px-2 py-1.5 text-sm text-gray-700 hover:bg-gray-100 rounded"
                >
                  {preset.label}
                </button>
              ))}
            </div>

            {/* Calendars */}
            <div className="flex">
              <CalendarMonth
                month={currentMonth}
                selectedRange={tempRange}
                hoverDate={hoverDate}
                onDateClick={handleDateClick}
                onDateHover={setHoverDate}
                onMonthChange={(dir) => setCurrentMonth(dir === 'prev' ? subMonths(currentMonth, 1) : addMonths(currentMonth, 1))}
                showNavigation={true}
              />
              <div className="border-l border-gray-200">
                <CalendarMonth
                  month={nextMonth}
                  selectedRange={tempRange}
                  hoverDate={hoverDate}
                  onDateClick={handleDateClick}
                  onDateHover={setHoverDate}
                  onMonthChange={(dir) => setCurrentMonth(dir === 'prev' ? subMonths(currentMonth, 1) : addMonths(currentMonth, 1))}
                  showNavigation={false}
                />
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="border-t border-gray-200 px-3 py-2 flex justify-between items-center">
            <span className="text-xs text-gray-500">
              {selectingEnd ? 'Select end date' : 'Select start date'}
            </span>
            <button
              onClick={() => setIsOpen(false)}
              className="text-sm text-blue-600 hover:text-blue-800 font-medium"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
