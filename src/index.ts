import { after } from "@vendetta/patcher";
import { findByProps, findByStoreName } from "@vendetta/metro";
import { storage } from "@vendetta/plugin";
import Settings from "./Settings";

storage.removeBanner ??= true;
storage.bannerExceptions ??= [];

let patches = [];
const sanitizedCache = new WeakMap();

const isExempt = (id) => !!id && storage.bannerExceptions.includes(String(id));

const shallowClonePreserveProto = (obj) => {
  if (!obj || typeof obj !== "object") return obj;
  const clone = Object.create(Object.getPrototypeOf(obj));
  Object.assign(clone, obj);
  return clone;
};

const getSanitizedUser = (user) => {
  if (!user || typeof user !== "object") return user;
  if (!storage.removeBanner || isExempt(user.id)) return user;
  let cached = sanitizedCache.get(user);
  if (!cached) {
    cached = shallowClonePreserveProto(user);
    sanitizedCache.set(user, cached);
  } else {
    Object.assign(cached, user);
  }
  cached.banner = null;
  cached.bannerColor = null;
  cached.accentColor = cached.accentColor ?? null;
  return cached;
};

const getSanitizedProfile = (profile) => {
  if (!profile || typeof profile !== "object") return profile;
  if (!storage.removeBanner || isExempt(profile.userId ?? profile.user?.id)) return profile;
  let cached = sanitizedCache.get(profile);
  if (!cached) {
    cached = shallowClonePreserveProto(profile);
    sanitizedCache.set(profile, cached);
  } else {
    Object.assign(cached, profile);
  }
  cached.banner = null;
  if (cached.premiumGuildSince !== undefined) cached.themeColors = null;
  return cached;
};

const safe = (fn) => (...args) => {
  try {
    return fn(...args);
  } catch {
    return undefined;
  }
};

export default {
  onLoad() {
    const unloadPatches = () => patches.forEach((p) => p?.());
    const load = () => {
      unloadPatches();
      patches = [];

      const userStore = findByStoreName("UserStore");
      if (userStore?.getUser) {
        patches.push(
          after("getUser", userStore, safe((args, res) => {
            if (!res) return res;
            return getSanitizedUser(res);
          }))
        );
      }

      const userProfileStore = findByStoreName("UserProfileStore");
      if (userProfileStore?.getUserProfile) {
        patches.push(
          after("getUserProfile", userProfileStore, safe((args, res) => {
            if (!res) return res;
            return getSanitizedProfile(res);
          }))
        );
      }

      const bannerUrlMod = findByProps("getUserBannerURL", "getUserAvatarURL");
      if (bannerUrlMod?.getUserBannerURL) {
        patches.push(
          after("getUserBannerURL", bannerUrlMod, safe((args, url) => {
            const id = args?.[0]?.id ?? args?.[0];
            if (!storage.removeBanner || isExempt(id)) return url;
            return null;
          }))
        );
      }

      const hookMod = findByProps("useUser", "useUserBanner");
      if (hookMod) {
        if (hookMod.useUser) {
          patches.push(
            after("useUser", hookMod, safe((args, res) => {
              if (!res) return res;
              return getSanitizedUser(res);
            }))
          );
        }
        if (hookMod.useUserBanner) {
          patches.push(
            after("useUserBanner", hookMod, safe((args, url) => {
              const id = args?.[0];
              if (!storage.removeBanner || isExempt(id)) return url;
              return null;
            }))
          );
        }
      }
    };
    load();
  },
  onUnload() {
    patches.forEach((p) => p?.());
  },
  settings: Settings,
};
