import { ref } from 'vue'

export function useBulkSelection() {
  const tableRef = ref(null)
  const selectedRows = ref([])
  const bulkBusy = ref(false)

  function handleSelectionChange(rows) {
    selectedRows.value = rows
  }

  function clearSelection() {
    tableRef.value?.clearSelection()
    selectedRows.value = []
  }

  return {
    tableRef,
    selectedRows,
    bulkBusy,
    handleSelectionChange,
    clearSelection,
  }
}
