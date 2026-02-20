import { createRouter, createWebHistory } from 'vue-router'
import HomeView from '@/views/HomeView.vue'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      name: 'home',
      component: HomeView,
    },
    {
      path: '/docs',
      name: 'docs',
      component: () => import('@/views/DocsView.vue'),
    },
    {
      path: '/privacy',
      name: 'privacy',
      component: () => import('@/views/PrivacyView.vue'),
    },
    {
      path: '/terms',
      name: 'terms',
      component: () => import('@/views/TermsView.vue'),
    },
  ],
  scrollBehavior(to) {
    if (to.hash) {
      return { el: to.hash, behavior: 'smooth' }
    }
    return { top: 0 }
  },
})

export default router
