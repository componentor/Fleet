import { computed } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { useAccountStore } from '@/stores/account'
import { useCart } from '@/composables/useCart'
import { useRouter } from 'vue-router'

export function useAuth() {
  const store = useAuthStore()
  const accountStore = useAccountStore()
  const cart = useCart()
  const router = useRouter()

  const user = computed(() => store.user)
  const isAuthenticated = computed(() => store.isAuthenticated)
  const isSuper = computed(() => store.isSuper)
  const loading = computed(() => store.loading)

  async function login(email: string, password: string) {
    await store.login({ email, password })
    await accountStore.fetchAccounts()
    sessionStorage.setItem('fleet_just_logged_in', '1')

    const redirect = router.currentRoute.value.query.redirect as string | undefined
    // Returning user with cart items — always go to checkout
    if (cart.count.value > 0) {
      await router.push('/checkout')
    } else if (redirect === '/onboarding') {
      // No cart — skip onboarding for returning users
      await router.push('/panel')
    } else if (redirect && redirect.startsWith('/') && !redirect.startsWith('//')) {
      await router.push(redirect)
    } else if (store.isSuper) {
      await router.push('/admin')
    } else {
      await router.push('/panel')
    }
  }

  async function register(name: string, email: string, password: string) {
    await store.register({ name, email, password })
    await accountStore.fetchAccounts()
    sessionStorage.setItem('fleet_just_logged_in', '1')
    // If there's an onboarding return URL, redirect there; otherwise go to panel
    const onboardingReturn = sessionStorage.getItem('fleet_onboarding_return')
    if (onboardingReturn) {
      sessionStorage.removeItem('fleet_onboarding_return')
      await router.push(onboardingReturn)
    } else {
      await router.push('/onboarding')
    }
  }

  async function logout() {
    await store.logout()
    accountStore.clear()
    await router.push('/login')
  }

  async function loadUser() {
    await store.loadUser()
    if (store.isAuthenticated) {
      await accountStore.fetchAccounts()
    }
  }

  return {
    user,
    isAuthenticated,
    isSuper,
    loading,
    login,
    register,
    logout,
    loadUser,
  }
}
