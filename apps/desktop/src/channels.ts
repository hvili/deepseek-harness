/** Narrow, versioned IPC channel names shared by preload and Main. */
export const IPC = {
  rpc: 'dsh:rpc',
  cancel: 'dsh:cancel',
  subscribe: 'dsh:subscribe',
  unsubscribe: 'dsh:unsubscribe',
  frame: 'dsh:frame',
  streamEnd: 'dsh:stream-end',
  windowAction: 'dsh:window-action',
  windowState: 'dsh:window-state',
  windowMaximized: 'dsh:window-maximized',
  notify: 'dsh:notify',
  openSession: 'dsh:open-session',
} as const
