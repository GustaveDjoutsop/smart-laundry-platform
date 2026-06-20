'use client';

import { useState, useEffect, useCallback } from 'react';
import { MessageSquare, Star, TrendingUp, AlertCircle, Filter, RefreshCw } from 'lucide-react';
import Header from '@/components/ui/Header';
import StarRating, { RatingBadge } from '@/components/ui/StarRating';
import DateRangePicker from '@/components/ui/DateRangePicker';
import { feedbackApi } from '@/lib/api';
import { formatDistanceToNow, format } from 'date-fns';
import type { FeedbackItem, FeedbackResponse, FeedbackAnalytics } from '@/types';

interface DateRange {
  startDate: Date | null;
  endDate: Date | null;
}

// Rating distribution bar component
function RatingBar({ rating, count, maxCount }: { rating: number; count: number; maxCount: number }) {
  const percentage = maxCount > 0 ? (count / maxCount) * 100 : 0;

  return (
    <div className="flex items-center gap-2">
      <span className="w-3 text-sm text-gray-600">{rating}</span>
      <Star className="w-4 h-4 text-yellow-400 fill-yellow-400" />
      <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
        <div
          className="h-full bg-yellow-400 rounded-full transition-all duration-500"
          style={{ width: `${percentage}%` }}
        />
      </div>
      <span className="w-8 text-sm text-gray-500 text-right">{count}</span>
    </div>
  );
}

// Feedback card component
function FeedbackCard({ feedback }: { feedback: FeedbackItem }) {
  const getRatingColor = (rating: number) => {
    if (rating >= 4) return 'border-l-green-500';
    if (rating >= 3) return 'border-l-yellow-500';
    return 'border-l-red-500';
  };

  const getRatingLabel = (rating: number) => {
    if (rating === 5) return 'Excellent';
    if (rating === 4) return 'Good';
    if (rating === 3) return 'Average';
    if (rating === 2) return 'Poor';
    return 'Very Poor';
  };

  return (
    <div className={`bg-white rounded-lg shadow-sm border-l-4 ${getRatingColor(feedback.rating)} p-4`}>
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-2">
            <StarRating rating={feedback.rating} size="md" />
            <span className={`text-sm font-medium ${feedback.rating <= 2 ? 'text-red-600' : feedback.rating >= 4 ? 'text-green-600' : 'text-yellow-600'}`}>
              {getRatingLabel(feedback.rating)}
            </span>
            <span className="text-sm text-gray-500">
              {formatDistanceToNow(new Date(feedback.submittedAt), { addSuffix: true })}
            </span>
          </div>

          {feedback.comment ? (
            <p className="text-gray-700 mb-3">&ldquo;{feedback.comment}&rdquo;</p>
          ) : feedback.rating <= 2 ? (
            <p className="text-gray-500 italic mb-3">Customer did not provide details. Consider following up.</p>
          ) : null}

          <div className="flex flex-wrap gap-2 text-xs text-gray-500">
            <span className="bg-gray-100 px-2 py-1 rounded">
              {feedback.machineName}
            </span>
            <span className="bg-gray-100 px-2 py-1 rounded">
              {feedback.cycleDuration} min cycle
            </span>
            <span className="bg-gray-100 px-2 py-1 rounded">
              {feedback.customerPhone || 'Anonymous'}
            </span>
            {feedback.staffAlertSent && (
              <span className="bg-red-100 text-red-700 px-2 py-1 rounded">
                Staff Alerted
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function FeedbackPage() {
  const [feedbackData, setFeedbackData] = useState<FeedbackResponse | null>(null);
  const [analytics, setAnalytics] = useState<FeedbackAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ratingFilter, setRatingFilter] = useState('');
  const [hasCommentFilter, setHasCommentFilter] = useState(false);
  const [dateRange, setDateRange] = useState<DateRange>({ startDate: null, endDate: null });
  const [page, setPage] = useState(1);

  // Format date range for API
  const getFormattedDateRange = useCallback(() => {
    return {
      startDate: dateRange.startDate ? format(dateRange.startDate, 'yyyy-MM-dd') : undefined,
      endDate: dateRange.endDate ? format(dateRange.endDate, 'yyyy-MM-dd') : undefined,
    };
  }, [dateRange]);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const { startDate, endDate } = getFormattedDateRange();

      const [feedbackResponse, analyticsResponse] = await Promise.all([
        feedbackApi.getAll({
          page,
          limit: 10,
          rating: ratingFilter ? parseInt(ratingFilter) : undefined,
          hasComment: hasCommentFilter || undefined,
          startDate,
          endDate,
        }),
        feedbackApi.getAnalytics('month'),
      ]);

      setFeedbackData(feedbackResponse);
      setAnalytics(analyticsResponse);
    } catch (err) {
      console.error('Failed to fetch feedback:', err);
      setError('Failed to load feedback data');
    } finally {
      setLoading(false);
    }
  }, [page, ratingFilter, hasCommentFilter, getFormattedDateRange]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Handle date range change
  const handleDateRangeChange = (range: DateRange) => {
    setDateRange(range);
    setPage(1);
  };

  const maxDistributionCount = feedbackData?.distribution
    ? Math.max(...feedbackData.distribution.map(d => d.count))
    : 0;

  if (loading && !feedbackData) {
    return (
      <>
        <Header title="Customer Feedback" />
        <main className="flex-1 overflow-y-auto p-6">
          <div className="animate-pulse space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-32 bg-gray-200 rounded-lg" />
              ))}
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="h-64 bg-gray-200 rounded-lg" />
              <div className="lg:col-span-2 space-y-4">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-24 bg-gray-200 rounded-lg" />
                ))}
              </div>
            </div>
          </div>
        </main>
      </>
    );
  }

  return (
    <>
      <Header title="Customer Feedback" />
      <main className="flex-1 overflow-y-auto p-6">
        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center text-red-700">
            <AlertCircle className="w-5 h-5 mr-2" />
            {error}
            <button
              onClick={fetchData}
              className="ml-auto text-sm underline hover:no-underline"
            >
              Retry
            </button>
          </div>
        )}

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="bg-white rounded-lg shadow-sm p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">Average Rating</p>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-3xl font-bold text-gray-900">
                    {feedbackData?.stats.averageRating || '-'}
                  </span>
                  <Star className="w-6 h-6 text-yellow-400 fill-yellow-400" />
                </div>
              </div>
              <div className="w-12 h-12 bg-yellow-100 rounded-full flex items-center justify-center">
                <Star className="w-6 h-6 text-yellow-600" />
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-sm p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">Total Reviews</p>
                <p className="text-3xl font-bold text-gray-900 mt-1">
                  {feedbackData?.stats.totalReviews || 0}
                </p>
              </div>
              <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center">
                <MessageSquare className="w-6 h-6 text-blue-600" />
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-sm p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">With Comments</p>
                <p className="text-3xl font-bold text-gray-900 mt-1">
                  {feedbackData?.stats.withComments || 0}
                </p>
              </div>
              <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center">
                <TrendingUp className="w-6 h-6 text-green-600" />
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Rating Distribution */}
          <div className="bg-white rounded-lg shadow-sm p-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Rating Distribution</h3>
            <div className="space-y-3">
              {feedbackData?.distribution.map((item) => (
                <RatingBar
                  key={item.rating}
                  rating={item.rating}
                  count={item.count}
                  maxCount={maxDistributionCount}
                />
              ))}
            </div>

            {/* Machine Ratings */}
            {analytics?.byMachine && analytics.byMachine.length > 0 && (
              <div className="mt-6 pt-4 border-t">
                <h4 className="text-sm font-medium text-gray-700 mb-3">By Machine</h4>
                <div className="space-y-2">
                  {analytics.byMachine.slice(0, 5).map((machine) => (
                    <div key={machine.machineId} className="flex items-center justify-between">
                      <span className="text-sm text-gray-600">{machine.name}</span>
                      <RatingBadge rating={machine.averageRating} size="sm" />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Reviews List */}
          <div className="lg:col-span-2 space-y-4">
            {/* Filters */}
            <div className="bg-white rounded-lg shadow-sm p-4">
              <div className="flex flex-wrap items-center gap-4">
                <div className="flex items-center gap-2">
                  <Filter className="w-4 h-4 text-gray-500" />
                  <span className="text-sm font-medium text-gray-700">Filters:</span>
                </div>

                <DateRangePicker
                  value={dateRange}
                  onChange={handleDateRangeChange}
                />

                <select
                  value={ratingFilter}
                  onChange={(e) => {
                    setRatingFilter(e.target.value);
                    setPage(1);
                  }}
                  className="text-sm border border-gray-300 rounded-md px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">All Ratings</option>
                  <option value="5">5 Stars</option>
                  <option value="4">4 Stars</option>
                  <option value="3">3 Stars</option>
                  <option value="2">2 Stars</option>
                  <option value="1">1 Star</option>
                </select>

                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={hasCommentFilter}
                    onChange={(e) => {
                      setHasCommentFilter(e.target.checked);
                      setPage(1);
                    }}
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  With Comments Only
                </label>

                <button
                  onClick={fetchData}
                  disabled={loading}
                  className="ml-auto flex items-center gap-2 px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900 disabled:opacity-50"
                >
                  <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                  Refresh
                </button>
              </div>
            </div>

            {/* Feedback Cards */}
            {feedbackData?.feedback && feedbackData.feedback.length > 0 ? (
              <div className="space-y-4">
                {feedbackData.feedback.map((item) => (
                  <FeedbackCard key={item.id} feedback={item} />
                ))}
              </div>
            ) : (
              <div className="bg-white rounded-lg shadow-sm p-8 text-center">
                <MessageSquare className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                <p className="text-gray-500">No feedback found</p>
                <p className="text-sm text-gray-400 mt-1">
                  Customer reviews will appear here once collected
                </p>
              </div>
            )}

            {/* Pagination */}
            {feedbackData?.pagination && feedbackData.pagination.pages > 1 && (
              <div className="flex items-center justify-center gap-2 pt-4">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="px-3 py-1.5 text-sm border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Previous
                </button>
                <span className="text-sm text-gray-600">
                  Page {page} of {feedbackData.pagination.pages}
                </span>
                <button
                  onClick={() => setPage(p => Math.min(feedbackData.pagination.pages, p + 1))}
                  disabled={page === feedbackData.pagination.pages}
                  className="px-3 py-1.5 text-sm border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Next
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Low Rating Alerts */}
        {analytics?.lowRatingAlerts && analytics.lowRatingAlerts.length > 0 && (
          <div className="mt-6 bg-red-50 rounded-lg p-4">
            <h3 className="text-lg font-semibold text-red-900 mb-3 flex items-center gap-2">
              <AlertCircle className="w-5 h-5" />
              Recent Low Ratings (Needs Attention)
            </h3>
            <div className="space-y-3">
              {analytics.lowRatingAlerts.map((alert) => (
                <div key={alert.id} className="bg-white rounded-lg p-3 border border-red-200">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <RatingBadge rating={alert.rating} size="sm" />
                      <span className="font-medium text-gray-900">{alert.machineName}</span>
                      <span className="text-sm text-gray-500">
                        {formatDistanceToNow(new Date(alert.submittedAt), { addSuffix: true })}
                      </span>
                    </div>
                    {alert.customerPhone && (
                      <span className="text-xs bg-gray-100 px-2 py-1 rounded text-gray-600">
                        {alert.customerPhone}
                      </span>
                    )}
                  </div>
                  {alert.comment ? (
                    <p className="mt-2 text-sm text-gray-700">&ldquo;{alert.comment}&rdquo;</p>
                  ) : (
                    <p className="mt-2 text-sm text-gray-500 italic">
                      No comment provided. Machine may need inspection.
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    </>
  );
}
