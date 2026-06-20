'use client';

import { Star } from 'lucide-react';
import { cn } from '@/lib/utils';

interface StarRatingProps {
  rating: number;
  maxRating?: number;
  size?: 'sm' | 'md' | 'lg';
  showValue?: boolean;
  className?: string;
}

const sizeClasses = {
  sm: 'w-3 h-3',
  md: 'w-4 h-4',
  lg: 'w-5 h-5',
};

const textSizeClasses = {
  sm: 'text-xs',
  md: 'text-sm',
  lg: 'text-base',
};

export default function StarRating({
  rating,
  maxRating = 5,
  size = 'md',
  showValue = false,
  className,
}: StarRatingProps) {
  const stars = [];
  const fullStars = Math.floor(rating);
  const hasHalfStar = rating % 1 >= 0.5;

  for (let i = 1; i <= maxRating; i++) {
    if (i <= fullStars) {
      // Full star
      stars.push(
        <Star
          key={i}
          className={cn(sizeClasses[size], 'fill-yellow-400 text-yellow-400')}
        />
      );
    } else if (i === fullStars + 1 && hasHalfStar) {
      // Half star (using gradient)
      stars.push(
        <div key={i} className="relative">
          <Star className={cn(sizeClasses[size], 'text-gray-300')} />
          <div className="absolute inset-0 overflow-hidden w-1/2">
            <Star className={cn(sizeClasses[size], 'fill-yellow-400 text-yellow-400')} />
          </div>
        </div>
      );
    } else {
      // Empty star
      stars.push(
        <Star
          key={i}
          className={cn(sizeClasses[size], 'text-gray-300')}
        />
      );
    }
  }

  return (
    <div className={cn('flex items-center gap-0.5', className)}>
      {stars}
      {showValue && (
        <span className={cn('ml-1 text-gray-600 font-medium', textSizeClasses[size])}>
          {rating.toFixed(1)}
        </span>
      )}
    </div>
  );
}

// Badge variant for compact display
interface RatingBadgeProps {
  rating: number;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export function RatingBadge({ rating, size = 'md', className }: RatingBadgeProps) {
  const getBadgeColor = (r: number) => {
    if (r >= 4.5) return 'bg-green-100 text-green-800';
    if (r >= 3.5) return 'bg-lime-100 text-lime-800';
    if (r >= 2.5) return 'bg-yellow-100 text-yellow-800';
    if (r >= 1.5) return 'bg-orange-100 text-orange-800';
    return 'bg-red-100 text-red-800';
  };

  const sizeStyles = {
    sm: 'px-1.5 py-0.5 text-xs',
    md: 'px-2 py-1 text-sm',
    lg: 'px-3 py-1.5 text-base',
  };

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full font-medium',
        getBadgeColor(rating),
        sizeStyles[size],
        className
      )}
    >
      <Star className={cn(sizeClasses[size], 'fill-current')} />
      {rating.toFixed(1)}
    </span>
  );
}
