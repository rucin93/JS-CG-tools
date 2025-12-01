import { create } from 'zustand'

interface InputStore {
  globalInput: string
  setGlobalInput: (input: string) => void
}

export const useInputStore = create<InputStore>((set) => ({
  globalInput: '',
  setGlobalInput: (input) => set({ globalInput: input }),
}))

