'use client';

import { useState } from 'react';
import Header from '@/components/ui/Header';
import {
  Coffee,
  Plus,
  TrendingUp,
  ShoppingBag,
  Clock,
  CreditCard,
} from 'lucide-react';
import { formatCurrency, formatDate, cn } from '@/lib/utils';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import type { CafeSale } from '@/types';

// Mock menu items
const menuItems = [
  { id: 1, name: 'Espresso', price: 500, category: 'coffee' },
  { id: 2, name: 'Cappuccino', price: 800, category: 'coffee' },
  { id: 3, name: 'Latte', price: 900, category: 'coffee' },
  { id: 4, name: 'Americano', price: 600, category: 'coffee' },
  { id: 5, name: 'Hot Chocolate', price: 700, category: 'drinks' },
  { id: 6, name: 'Fresh Juice', price: 1000, category: 'drinks' },
  { id: 7, name: 'Water', price: 300, category: 'drinks' },
  { id: 8, name: 'Soft Drink', price: 500, category: 'drinks' },
  { id: 9, name: 'Croissant', price: 600, category: 'snacks' },
  { id: 10, name: 'Sandwich', price: 1500, category: 'snacks' },
  { id: 11, name: 'Cake Slice', price: 800, category: 'snacks' },
  { id: 12, name: 'Cookies', price: 400, category: 'snacks' },
];

// Mock sales data
const mockSales: CafeSale[] = Array.from({ length: 20 }, (_, i) => ({
  id: `sale-${i + 1}`,
  date: new Date(Date.now() - i * 45 * 60000),
  items: [
    {
      name: menuItems[i % menuItems.length].name,
      quantity: 1 + (i % 3),
      unitPrice: menuItems[i % menuItems.length].price,
      total: menuItems[i % menuItems.length].price * (1 + (i % 3)),
    },
  ],
  paymentMethod: ['Cash', 'MTN', 'Orange', 'Wave'][i % 4],
  total: menuItems[i % menuItems.length].price * (1 + (i % 3)),
}));

const hourlyData = [
  { hour: '8AM', sales: 5500 },
  { hour: '9AM', sales: 8200 },
  { hour: '10AM', sales: 12000 },
  { hour: '11AM', sales: 9500 },
  { hour: '12PM', sales: 15000 },
  { hour: '1PM', sales: 13500 },
  { hour: '2PM', sales: 8000 },
  { hour: '3PM', sales: 10500 },
  { hour: '4PM', sales: 11000 },
  { hour: '5PM', sales: 7500 },
];

const categoryColors: Record<string, string> = {
  coffee: 'bg-amber-100 text-amber-700',
  drinks: 'bg-blue-100 text-blue-700',
  snacks: 'bg-green-100 text-green-700',
};

type TabType = 'sales' | 'menu' | 'pos';

export default function CafePage() {
  const [activeTab, setActiveTab] = useState<TabType>('sales');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');

  const todaySales = mockSales.reduce((sum, sale) => sum + sale.total, 0);
  const totalTransactions = mockSales.length;
  const avgTransaction = todaySales / totalTransactions;

  const filteredMenu =
    selectedCategory === 'all'
      ? menuItems
      : menuItems.filter((item) => item.category === selectedCategory);

  return (
    <>
      <Header title="Cafe" />
      <main className="flex-1 overflow-y-auto p-6">
        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <div className="card">
            <div className="flex items-center">
              <div className="p-3 rounded-lg bg-success-50 text-success-600 mr-4">
                <TrendingUp className="w-6 h-6" />
              </div>
              <div>
                <p className="text-sm text-gray-500">Today&apos;s Sales</p>
                <p className="text-2xl font-bold text-gray-900">
                  {formatCurrency(todaySales)}
                </p>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="flex items-center">
              <div className="p-3 rounded-lg bg-primary-50 text-primary-600 mr-4">
                <ShoppingBag className="w-6 h-6" />
              </div>
              <div>
                <p className="text-sm text-gray-500">Transactions</p>
                <p className="text-2xl font-bold text-gray-900">{totalTransactions}</p>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="flex items-center">
              <div className="p-3 rounded-lg bg-warning-50 text-warning-600 mr-4">
                <CreditCard className="w-6 h-6" />
              </div>
              <div>
                <p className="text-sm text-gray-500">Avg Transaction</p>
                <p className="text-2xl font-bold text-gray-900">
                  {formatCurrency(avgTransaction)}
                </p>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="flex items-center">
              <div className="p-3 rounded-lg bg-amber-50 text-amber-600 mr-4">
                <Coffee className="w-6 h-6" />
              </div>
              <div>
                <p className="text-sm text-gray-500">Top Item</p>
                <p className="text-2xl font-bold text-gray-900">Cappuccino</p>
              </div>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex space-x-2 mb-6">
          {(['sales', 'menu', 'pos'] as TabType[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={cn(
                'px-4 py-2 rounded-lg text-sm font-medium transition-colors',
                activeTab === tab
                  ? 'bg-primary-500 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              )}
            >
              {tab === 'pos' ? 'POS' : tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>

        {/* Sales Tab */}
        {activeTab === 'sales' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Hourly Sales Chart */}
            <div className="card">
              <h3 className="card-title mb-4">Hourly Sales</h3>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={hourlyData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis
                      dataKey="hour"
                      axisLine={false}
                      tickLine={false}
                      tick={{ fill: '#6b7280', fontSize: 12 }}
                    />
                    <YAxis
                      axisLine={false}
                      tickLine={false}
                      tick={{ fill: '#6b7280', fontSize: 12 }}
                      tickFormatter={(value) => `${(value / 1000).toFixed(0)}K`}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#fff',
                        border: '1px solid #e5e7eb',
                        borderRadius: '8px',
                      }}
                      formatter={(value: number) => [formatCurrency(value), 'Sales']}
                    />
                    <Bar dataKey="sales" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Recent Sales */}
            <div className="card">
              <h3 className="card-title mb-4">Recent Sales</h3>
              <div className="space-y-3 max-h-64 overflow-y-auto">
                {mockSales.slice(0, 10).map((sale) => (
                  <div
                    key={sale.id}
                    className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
                  >
                    <div>
                      <p className="font-medium text-gray-900">
                        {sale.items.map((i) => `${i.quantity}x ${i.name}`).join(', ')}
                      </p>
                      <p className="text-xs text-gray-500">
                        {formatDate(sale.date, { timeStyle: 'short', dateStyle: undefined })} - {sale.paymentMethod}
                      </p>
                    </div>
                    <span className="font-semibold text-gray-900">
                      {formatCurrency(sale.total)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Menu Tab */}
        {activeTab === 'menu' && (
          <div className="card">
            <div className="flex justify-between items-center mb-4">
              <h3 className="card-title">Menu Items</h3>
              <button className="btn btn-primary">
                <Plus className="w-4 h-4 mr-2" />
                Add Item
              </button>
            </div>

            {/* Category Filter */}
            <div className="flex space-x-2 mb-4">
              {['all', 'coffee', 'drinks', 'snacks'].map((cat) => (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(cat)}
                  className={cn(
                    'px-3 py-1 rounded-full text-sm font-medium transition-colors',
                    selectedCategory === cat
                      ? 'bg-primary-500 text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  )}
                >
                  {cat.charAt(0).toUpperCase() + cat.slice(1)}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredMenu.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between p-4 bg-gray-50 rounded-lg"
                >
                  <div>
                    <p className="font-medium text-gray-900">{item.name}</p>
                    <span className={cn('badge text-xs mt-1', categoryColors[item.category])}>
                      {item.category}
                    </span>
                  </div>
                  <span className="font-semibold text-gray-900">
                    {formatCurrency(item.price)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* POS Tab */}
        {activeTab === 'pos' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Menu Items */}
            <div className="lg:col-span-2 card">
              <h3 className="card-title mb-4">Select Items</h3>
              <div className="flex space-x-2 mb-4">
                {['all', 'coffee', 'drinks', 'snacks'].map((cat) => (
                  <button
                    key={cat}
                    onClick={() => setSelectedCategory(cat)}
                    className={cn(
                      'px-3 py-1 rounded-full text-sm font-medium transition-colors',
                      selectedCategory === cat
                        ? 'bg-primary-500 text-white'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    )}
                  >
                    {cat.charAt(0).toUpperCase() + cat.slice(1)}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {filteredMenu.map((item) => (
                  <button
                    key={item.id}
                    className="p-4 bg-gray-50 hover:bg-gray-100 rounded-lg text-left transition-colors"
                  >
                    <p className="font-medium text-gray-900">{item.name}</p>
                    <p className="text-sm text-primary-600 mt-1">
                      {formatCurrency(item.price)}
                    </p>
                  </button>
                ))}
              </div>
            </div>

            {/* Cart */}
            <div className="card">
              <h3 className="card-title mb-4">Current Order</h3>
              <div className="space-y-3 mb-4">
                <p className="text-gray-500 text-center py-8">
                  No items added yet
                </p>
              </div>
              <div className="border-t pt-4">
                <div className="flex justify-between mb-4">
                  <span className="font-medium text-gray-900">Total</span>
                  <span className="font-bold text-xl text-gray-900">
                    {formatCurrency(0)}
                  </span>
                </div>
                <button className="btn btn-primary w-full" disabled>
                  Complete Sale
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </>
  );
}
