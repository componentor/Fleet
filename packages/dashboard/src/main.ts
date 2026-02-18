import './styles.css'

import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { router } from './router'
import { i18n } from './i18n'
import { useAuthStore } from './stores/auth'

const app = createApp(App)
const pinia = createPinia()

app.use(pinia)
app.use(i18n)
app.use(router)

app.config.errorHandler = (err, _instance, info) => {
  console.error(`[Fleet] Unhandled error (${info}):`, err)
}

// Initialize auth (silent refresh from httpOnly cookie) before mounting
const authStore = useAuthStore()
authStore.init().finally(() => {
  app.mount('#app')
})
