/// <reference types="vite/client" />

interface Window {
  MonacoEnvironment: { getWorker: (_moduleId: string, _label: string) => Worker }
}
