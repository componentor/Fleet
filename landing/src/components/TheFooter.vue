<template>
  <footer class="border-t border-surface-200 dark:border-surface-800/50 py-12">
    <div class="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
      <div class="flex flex-col items-center justify-between gap-8 md:flex-row">
        <!-- Branding -->
        <div class="flex flex-col items-center gap-2 md:items-start">
          <div class="flex items-center gap-2">
            <div class="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-primary-500 to-primary-700">
              <svg class="h-4 w-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <span class="text-lg font-bold text-gray-900 dark:text-white">Fleet</span>
          </div>
          <p class="text-sm text-surface-500">{{ $t('footer.builtWith') }}</p>
        </div>

        <!-- Links -->
        <div class="flex items-center gap-8">
          <a
            href="https://github.com/fleet"
            target="_blank"
            rel="noopener noreferrer"
            class="text-sm text-surface-500 dark:text-surface-400 transition-colors hover:text-gray-900 dark:hover:text-white"
          >
            {{ $t('footer.github') }}
          </a>
          <router-link
            to="/docs"
            class="text-sm text-surface-500 dark:text-surface-400 transition-colors hover:text-gray-900 dark:hover:text-white"
          >
            {{ $t('footer.docs') }}
          </router-link>
          <router-link
            to="/privacy"
            class="text-sm text-surface-500 dark:text-surface-400 transition-colors hover:text-gray-900 dark:hover:text-white"
          >
            {{ $t('footer.privacy') }}
          </router-link>
          <router-link
            to="/terms"
            class="text-sm text-surface-500 dark:text-surface-400 transition-colors hover:text-gray-900 dark:hover:text-white"
          >
            {{ $t('footer.terms') }}
          </router-link>
          <router-link
            to="/status"
            class="text-sm text-surface-500 dark:text-surface-400 transition-colors hover:text-gray-900 dark:hover:text-white"
          >
            {{ $t('footer.status') }}
          </router-link>
        </div>

        <!-- Copyright -->
        <p class="text-sm text-surface-500">
          &copy; {{ new Date().getFullYear() }} {{ $t('footer.rights') }}
        </p>
      </div>
    </div>
  </footer>
</template>
