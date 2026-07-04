export const uiTokens = {
  border: {
    subtle: 'rgba(255,255,255,0.12)',
    warning: 'rgba(255, 190, 85, 0.82)',
    statCard: '#1a3048',
    statDivider: '#0e1e2e',
  },
  color: {
    text: {
      primary: '#ddd',
      muted: '#888',
      quiet: '#556',
      subtle: '#445',
      disabled: '#9a8f6a',
    },
    status: {
      warning: '#d8b35d',
      pending: '#ffcf7a',
      pendingText: '#fff3d1',
      pendingMuted: '#c7bda3',
      success: '#b7d7c8',
    },
    combat: {
      weaponName: '#aac8e8',
      attacks: '#e2c16b',
      hit: '#8ab4ff',
      save: '#d07030',
      noSave: '#ff5722',
      damage: '#9b8fd4',
      cover: '#00dcc3',
      coverMuted: '#00aaa0',
      apWarning: '#ff9f43',
    },
  },
  surface: {
    panel: 'rgba(255,255,255,0.035)',
    pendingHud: 'rgba(12, 10, 7, 0.94)',
    statCard: '#080f18',
  },
  radius: {
    panel: '8px',
    statCard: 6,
  },
  shadow: {
    pendingHud: '0 8px 24px rgba(0,0,0,0.34)',
  },
} as const;
