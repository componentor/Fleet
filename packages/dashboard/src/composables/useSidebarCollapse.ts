import { ref } from 'vue'

const collapsed = ref(localStorage.getItem('fleet_sidebar_collapsed') === 'true')

export function useSidebarCollapse() {
  function toggle() {
    collapsed.value = !collapsed.value
    localStorage.setItem('fleet_sidebar_collapsed', String(collapsed.value))
  }
  return { collapsed, toggle }
}
