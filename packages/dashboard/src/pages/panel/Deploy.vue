<script setup lang="ts">
import { ref } from 'vue'
import { Rocket, Github, FileCode2 } from 'lucide-vue-next'

const deployMethod = ref<'github' | 'compose' | null>(null)
const repoUrl = ref('')
const branch = ref('main')
const composeYaml = ref('')
const loading = ref(false)
</script>

<template>
  <div>
    <div class="flex items-center gap-3 mb-8">
      <Rocket class="w-7 h-7 text-primary-600 dark:text-primary-400" />
      <h1 class="text-2xl font-bold text-gray-900 dark:text-white">Deploy</h1>
    </div>

    <!-- Deploy method selection -->
    <div v-if="!deployMethod" class="grid grid-cols-1 sm:grid-cols-2 gap-6 max-w-2xl">
      <button
        @click="deployMethod = 'github'"
        class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-8 text-left hover:border-primary-300 dark:hover:border-primary-600 hover:shadow-md transition-all group"
      >
        <div class="w-12 h-12 rounded-lg bg-gray-900 dark:bg-white flex items-center justify-center mb-4">
          <Github class="w-6 h-6 text-white dark:text-gray-900" />
        </div>
        <h3 class="text-lg font-semibold text-gray-900 dark:text-white mb-2">From GitHub</h3>
        <p class="text-sm text-gray-500 dark:text-gray-400">Deploy from a GitHub repository with automatic builds.</p>
      </button>

      <button
        @click="deployMethod = 'compose'"
        class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-8 text-left hover:border-primary-300 dark:hover:border-primary-600 hover:shadow-md transition-all group"
      >
        <div class="w-12 h-12 rounded-lg bg-blue-600 flex items-center justify-center mb-4">
          <FileCode2 class="w-6 h-6 text-white" />
        </div>
        <h3 class="text-lg font-semibold text-gray-900 dark:text-white mb-2">From Docker Compose</h3>
        <p class="text-sm text-gray-500 dark:text-gray-400">Paste a Docker Compose YAML to deploy a full stack.</p>
      </button>
    </div>

    <!-- GitHub deploy form -->
    <div v-if="deployMethod === 'github'" class="max-w-2xl">
      <button
        @click="deployMethod = null"
        class="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 mb-6 transition-colors"
      >
        &larr; Back to options
      </button>

      <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
        <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 class="text-lg font-semibold text-gray-900 dark:text-white">Deploy from GitHub</h2>
        </div>
        <div class="p-6 space-y-5">
          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Repository URL</label>
            <input
              v-model="repoUrl"
              type="url"
              placeholder="https://github.com/user/repo"
              class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
            />
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Branch</label>
            <input
              v-model="branch"
              type="text"
              placeholder="main"
              class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
            />
          </div>
        </div>
        <div class="px-6 py-4 border-t border-gray-200 dark:border-gray-700 flex justify-end">
          <button
            :disabled="loading || !repoUrl"
            class="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-medium transition-colors"
          >
            <Rocket class="w-4 h-4" />
            {{ loading ? 'Deploying...' : 'Deploy' }}
          </button>
        </div>
      </div>
    </div>

    <!-- Docker Compose deploy form -->
    <div v-if="deployMethod === 'compose'" class="max-w-2xl">
      <button
        @click="deployMethod = null"
        class="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 mb-6 transition-colors"
      >
        &larr; Back to options
      </button>

      <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
        <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 class="text-lg font-semibold text-gray-900 dark:text-white">Deploy from Docker Compose</h2>
        </div>
        <div class="p-6 space-y-5">
          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Docker Compose YAML</label>
            <textarea
              v-model="composeYaml"
              rows="16"
              placeholder="version: '3.8'
services:
  web:
    image: nginx:latest
    ports:
      - '80:80'"
              class="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm font-mono"
            ></textarea>
          </div>
        </div>
        <div class="px-6 py-4 border-t border-gray-200 dark:border-gray-700 flex justify-end">
          <button
            :disabled="loading || !composeYaml"
            class="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-medium transition-colors"
          >
            <Rocket class="w-4 h-4" />
            {{ loading ? 'Deploying...' : 'Deploy' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
