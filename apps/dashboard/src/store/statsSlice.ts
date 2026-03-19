import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import { api } from '../api/client.js';

/* ── Types ── */

interface Stats {
  total: number;
  byType: { type: string; count: number }[];
  byScope: { scope: string; count: number }[];
}

interface Metrics {
  database: { sizeBytes: number; sizeFormatted: string; path: string };
  activity: { last24h: number; last7d: number; last30d: number; total: number };
  activityByDay: { date: string; count: number }[];
  heatmap: { date: string; count: number }[];
  typeDistribution: { name: string; value: number }[];
}

type LoadState = 'idle' | 'loading' | 'loaded' | 'empty' | 'error';

interface StatsState {
  stats: Stats | null;
  statsState: LoadState;
  metrics: Metrics | null;
  metricsState: LoadState;
  tags: string[];
  tagsState: LoadState;
  /** timestamp of last successful fetch — used to skip refetch if recent */
  lastFetchedAt: number | null;
}

const initialState: StatsState = {
  stats: null,
  statsState: 'idle',
  metrics: null,
  metricsState: 'idle',
  tags: [],
  tagsState: 'idle',
  lastFetchedAt: null,
};

/* ── Thunks ── */

export const fetchStats = createAsyncThunk(
  'stats/fetchStats',
  async (_, { rejectWithValue }) => {
    let attempt = 0;
    while (attempt < 3) {
      try {
        attempt++;
        const data = await api.getStats();
        return data as Stats;
      } catch {
        if (attempt >= 3) return rejectWithValue('Failed after 3 attempts');
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  },
);

export const fetchMetrics = createAsyncThunk(
  'stats/fetchMetrics',
  async (_, { rejectWithValue }) => {
    let attempt = 0;
    while (attempt < 3) {
      try {
        attempt++;
        const data = await api.getMetrics();
        return data as Metrics;
      } catch {
        if (attempt >= 3) return rejectWithValue('Failed after 3 attempts');
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  },
);

export const fetchTags = createAsyncThunk(
  'stats/fetchTags',
  async (_, { rejectWithValue }) => {
    try {
      return (await api.listTags()) as string[];
    } catch {
      return rejectWithValue('Failed to load tags');
    }
  },
);

/* ── Slice ── */

const statsSlice = createSlice({
  name: 'stats',
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    // Stats
    builder
      .addCase(fetchStats.pending, (state) => {
        // Only show loading if we have no cached data
        if (!state.stats) state.statsState = 'loading';
      })
      .addCase(fetchStats.fulfilled, (state, action) => {
        state.stats = action.payload ?? null;
        state.statsState = action.payload && action.payload.total > 0 ? 'loaded' : 'empty';
        state.lastFetchedAt = Date.now();
      })
      .addCase(fetchStats.rejected, (state) => {
        if (!state.stats) {
          state.stats = { total: 0, byType: [], byScope: [] };
          state.statsState = 'empty';
        }
      });

    // Metrics
    builder
      .addCase(fetchMetrics.pending, (state) => {
        if (!state.metrics) state.metricsState = 'loading';
      })
      .addCase(fetchMetrics.fulfilled, (state, action) => {
        state.metrics = action.payload ?? null;
        state.metricsState = 'loaded';
      })
      .addCase(fetchMetrics.rejected, (state) => {
        if (!state.metrics) state.metricsState = 'error';
      });

    // Tags
    builder
      .addCase(fetchTags.pending, (state) => {
        if (state.tags.length === 0) state.tagsState = 'loading';
      })
      .addCase(fetchTags.fulfilled, (state, action) => {
        state.tags = action.payload ?? [];
        state.tagsState = state.tags.length > 0 ? 'loaded' : 'empty';
      })
      .addCase(fetchTags.rejected, (state) => {
        if (state.tags.length === 0) state.tagsState = 'error';
      });
  },
});

export const statsReducer = statsSlice.reducer;
