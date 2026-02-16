<script setup lang="ts">
import { Store, Rocket } from 'lucide-vue-next'

const apps = [
  { name: 'WordPress', description: 'Popular CMS and blogging platform', category: 'CMS', image: 'wordpress:latest' },
  { name: 'Ghost', description: 'Modern publishing platform for creators', category: 'CMS', image: 'ghost:latest' },
  { name: 'PostgreSQL', description: 'Advanced open-source relational database', category: 'Database', image: 'postgres:16' },
  { name: 'MySQL', description: 'Most popular open-source relational database', category: 'Database', image: 'mysql:8' },
  { name: 'Redis', description: 'In-memory data store and message broker', category: 'Database', image: 'redis:7' },
  { name: 'MongoDB', description: 'Document-oriented NoSQL database', category: 'Database', image: 'mongo:7' },
  { name: 'Nginx', description: 'High-performance web server and reverse proxy', category: 'Web Server', image: 'nginx:latest' },
  { name: 'Node.js', description: 'JavaScript runtime for server-side applications', category: 'Runtime', image: 'node:20' },
  { name: 'MinIO', description: 'S3-compatible high-performance object storage', category: 'Storage', image: 'minio/minio:latest' },
]

function categoryColor(category: string) {
  switch (category) {
    case 'CMS': return 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
    case 'Database': return 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
    case 'Web Server': return 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300'
    case 'Runtime': return 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300'
    case 'Storage': return 'bg-pink-100 dark:bg-pink-900/30 text-pink-700 dark:text-pink-300'
    default: return 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
  }
}
</script>

<template>
  <div>
    <div class="flex items-center gap-3 mb-8">
      <Store class="w-7 h-7 text-primary-600 dark:text-primary-400" />
      <h1 class="text-2xl font-bold text-gray-900 dark:text-white">App Marketplace</h1>
    </div>

    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
      <div
        v-for="app in apps"
        :key="app.name"
        class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden"
      >
        <div class="p-6">
          <div class="flex items-start justify-between mb-3">
            <h3 class="text-sm font-semibold text-gray-900 dark:text-white">{{ app.name }}</h3>
            <span :class="['inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium', categoryColor(app.category)]">
              {{ app.category }}
            </span>
          </div>
          <p class="text-sm text-gray-600 dark:text-gray-400 mb-3">{{ app.description }}</p>
          <p class="text-xs text-gray-500 dark:text-gray-500 font-mono">{{ app.image }}</p>
        </div>
        <div class="px-6 py-3 bg-gray-50 dark:bg-gray-750 border-t border-gray-200 dark:border-gray-700">
          <button class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-xs font-medium transition-colors">
            <Rocket class="w-3.5 h-3.5" />
            Deploy
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
