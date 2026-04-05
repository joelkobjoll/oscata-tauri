import { useCallback, useEffect, useState } from "react";
import { call } from "../../lib/transport";
import type { QualityProfile } from "./types";

interface CreateProfileParams {
  name: string;
  min_resolution?: string;
  preferred_resolution?: string;
  prefer_hdr: boolean;
  preferred_codecs: string;
  preferred_audio_codecs: string;
  preferred_release_types: string;
  min_size_gb?: number;
  max_size_gb?: number;
}

interface UpdateProfileParams extends CreateProfileParams {
  id: number;
}

interface UseQualityProfilesResult {
  profiles: QualityProfile[];
  loading: boolean;
  error: string | null;
  createProfile: (params: CreateProfileParams) => Promise<QualityProfile>;
  updateProfile: (params: UpdateProfileParams) => Promise<void>;
  deleteProfile: (id: number) => Promise<void>;
  refetch: () => Promise<void>;
}

export function useQualityProfiles(): UseQualityProfilesResult {
  const [profiles, setProfiles] = useState<QualityProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    try {
      const data = await call<QualityProfile[]>("get_quality_profiles");
      setProfiles(data);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    refetch().finally(() => setLoading(false));
  }, [refetch]);

  const createProfile = useCallback(
    async (params: CreateProfileParams): Promise<QualityProfile> => {
      const profile = await call<QualityProfile>("create_quality_profile", {
        name: params.name,
        minResolution: params.min_resolution ?? null,
        preferredResolution: params.preferred_resolution ?? null,
        preferHdr: params.prefer_hdr,
        preferredCodecs: params.preferred_codecs,
        preferredAudioCodecs: params.preferred_audio_codecs,
        preferredReleaseTypes: params.preferred_release_types,
        minSizeGb: params.min_size_gb ?? null,
        maxSizeGb: params.max_size_gb ?? null,
      });
      await refetch();
      return profile;
    },
    [refetch],
  );

  const updateProfile = useCallback(
    async (params: UpdateProfileParams): Promise<void> => {
      await call<void>("update_quality_profile", {
        id: params.id,
        name: params.name,
        minResolution: params.min_resolution ?? null,
        preferredResolution: params.preferred_resolution ?? null,
        preferHdr: params.prefer_hdr,
        preferredCodecs: params.preferred_codecs,
        preferredAudioCodecs: params.preferred_audio_codecs,
        preferredReleaseTypes: params.preferred_release_types,
        minSizeGb: params.min_size_gb ?? null,
        maxSizeGb: params.max_size_gb ?? null,
      });
      await refetch();
    },
    [refetch],
  );

  const deleteProfile = useCallback(
    async (id: number): Promise<void> => {
      await call<void>("delete_quality_profile", { id });
      await refetch();
    },
    [refetch],
  );

  return {
    profiles,
    loading,
    error,
    createProfile,
    updateProfile,
    deleteProfile,
    refetch,
  };
}
