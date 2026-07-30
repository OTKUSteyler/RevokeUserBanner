import { after } from "@vendetta/patcher";
import { findByProps, findByStoreName } from "@vendetta/metro";
import { storage } from "@vendetta/plugin";
import { React, ReactNative } from "@vendetta/metro/common";
import { Forms } from "@vendetta/ui/components";
import { showToast } from "@vendetta/ui/toasts";

storage.removeBanner ??= true;
storage.exemptFriends ??= true;
storage.bannerExceptions ??= [];

let patches = [];

const isFriend = (id) => {
  if (!id) return false;
  try {
    const store = findByStoreName("RelationshipStore");
    if (!store) return false;
    if (store.isFriend) return store.isFriend(id);
    return store.getRelationshipType?.(id) === 1;
  } catch {
    return false;
  }
};

const isExempt = (id) => {
  if (!id) return false;
  const strId = String(id);
  if (storage.bannerExceptions.includes(strId)) return true;
  if (storage.exemptFriends && isFriend(strId)) return true;
  return false;
};

const BANNER_FIELDS = ["banner", "bannerColor"];

// Returns a version of obj with banner fields nulled, WITHOUT losing its
// prototype chain. A plain `{ ...obj }` spread strips the class prototype,
// which drops methods other parts of Discord expect to still exist on the
// object — that's what caused "undefined is not a function" crashes.
const withNulledFields = (obj, fields) => {
  if (!obj || typeof obj !== "object") return obj;

  // Prefer the record's own immutable update method if it has one (common
  // on Immutable.js-style records) — safest, keeps all invariants intact.
  if (typeof obj.set === "function") {
    let next = obj;
    for (const f of fields) {
      try {
        next = next.set(f, null);
      } catch {
        // field not present on this record type — ignore
      }
    }
    return next;
  }

  // Fallback: clone onto the same prototype so any class methods
  // (getAvatarURL, etc.) keep working after the copy.
  const clone = Object.create(Object.getPrototypeOf(obj));
  Object.assign(clone, obj);
  for (const f of fields) clone[f] = null;
  return clone;
};

const stripBannerFields = (obj) => withNulledFields(obj, BANNER_FIELDS);

// Server-specific ("per-guild") profiles carry their own banner override,
// nested under a key that's commonly `guildMemberProfile`. If the field
// name differs on your client build, inspect a live getUserProfile()
// result in the debugger and adjust the key below.
const GUILD_PROFILE_KEY = "guildMemberProfile";

const applyBannerState = (profile, id) => {
  if (!profile || typeof profile !== "object" || !id) return profile;
  if (!storage.removeBanner || isExempt(id)) return profile;

  let result = stripBannerFields(profile);

  if (result[GUILD_PROFILE_KEY]) {
    // Overwrite the one property rather than spreading the whole object,
    // so result keeps whatever prototype stripBannerFields gave it.
    result[GUILD_PROFILE_KEY] = stripBannerFields(result[GUILD_PROFILE_KEY]);
  }

  return result;
};

const safe = (fn) => (...args) => {
  try {
    return fn(...args);
  } catch {
    return undefined;
  }
};

const idFromArgs = (args, res) =>
  res?.id ?? res?.userId ?? res?.user?.id ??
  args?.[0]?.id ?? args?.[0] ??
  args?.[1]?.id ?? args?.[1];

function Settings() {
  const [, forceUpdate] = React.useReducer((x) => x + 1, 0);
  const [input, setInput] = React.useState("");
  const { FormSwitchRow, FormInput, FormRow, FormSection, FormDivider } = Forms;
  const { View, TouchableOpacity, Text } = ReactNative;
  const h = React.createElement;
  const UserStore = findByStoreName("UserStore");

  const addException = () => {
    const id = input.trim();
    if (!id) return;
    if (!/^\d+$/.test(id)) {
      showToast("Enter a valid user ID");
      return;
    }
    if (storage.bannerExceptions.includes(id)) {
      showToast("Already in the list");
      return;
    }
    storage.bannerExceptions.push(id);
    setInput("");
    forceUpdate();
    showToast("Added to exceptions");
  };

  const removeException = (id) => {
    storage.bannerExceptions = storage.bannerExceptions.filter((x) => x !== id);
    forceUpdate();
  };

  return h(
    View,
    null,
    h(
      FormSection,
      { title: "General" },
      h(FormSwitchRow, {
        label: "Remove banners",
        subLabel: "Strips banners from users everywhere, including server profiles",
        value: storage.removeBanner,
        onValueChange: (v) => {
          storage.removeBanner = v;
          forceUpdate();
        },
      }),
      h(FormSwitchRow, {
        label: "Keep friends' banners",
        subLabel: "Friends are automatically whitelisted",
        value: storage.exemptFriends,
        onValueChange: (v) => {
          storage.exemptFriends = v;
          forceUpdate();
        },
      })
    ),
    h(
      FormSection,
      { title: "Other exceptions" },
      h(FormInput, {
        title: "User ID",
        placeholder: "Add a non-friend's user ID to keep their banner",
        value: input,
        onChange: setInput,
        onSubmitEditing: addException,
        returnKeyType: "done",
      }),
      h(
        TouchableOpacity,
        {
          onPress: addException,
          style: {
            marginHorizontal: 16,
            marginTop: 8,
            marginBottom: 4,
            paddingVertical: 10,
            borderRadius: 8,
            backgroundColor: "#5865F2",
            alignItems: "center",
          },
        },
        h(Text, { style: { color: "#fff", fontWeight: "600" } }, "Add User ID")
      ),
      h(FormDivider, null),
      storage.bannerExceptions.length === 0 &&
        h(FormRow, { label: "No manual exceptions added" }),
      ...storage.bannerExceptions.map((id) => {
        const user = UserStore?.getUser?.(id);
        return h(FormRow, {
          key: id,
          label: user?.username ?? id,
          subLabel: id,
          onPress: () => removeException(id),
        });
      })
    )
  );
}

export default {
  onLoad() {
    const unloadPatches = () => patches.forEach((p) => p?.());

    const applyPatches = () => {
      unloadPatches();
      patches = [];

      // --- Original targeted patches (kept — cheap, and correct when they hit) ---

      const userStore = findByStoreName("UserStore");
      if (userStore?.getUser) {
        patches.push(
          after("getUser", userStore, safe((args, res) => {
            if (!res) return res;
            return applyBannerState(res, res.id);
          }))
        );
      }

      const userProfileStore = findByStoreName("UserProfileStore");
      if (userProfileStore?.getUserProfile) {
        patches.push(
          after("getUserProfile", userProfileStore, safe((args, res) => {
            if (!res) return res;
            const id = res.userId ?? res.user?.id ?? args?.[0];
            const next = applyBannerState(res, id);
            if (next.user) next.user = applyBannerState(next.user, id);
            return next;
          }))
        );
      }

      const guildMemberProfileStore = findByStoreName("GuildMemberProfileStore");
      if (guildMemberProfileStore?.getGuildMemberProfile) {
        patches.push(
          after("getGuildMemberProfile", guildMemberProfileStore, safe((args, res) => {
            if (!res) return res;
            const id = res.userId ?? args?.[1] ?? args?.[0];
            return applyBannerState(res, id);
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

      if (bannerUrlMod?.getGuildMemberBannerURL) {
        patches.push(
          after("getGuildMemberBannerURL", bannerUrlMod, safe((args, url) => {
            const id = args?.[0]?.userId ?? args?.[0]?.id ?? args?.[1];
            if (!storage.removeBanner || isExempt(id)) return url;
            return null;
          }))
        );
      }

      const hookMod = findByProps("useUserBanner");
      if (hookMod?.useUserBanner) {
        patches.push(
          after("useUserBanner", hookMod, safe((args, url) => {
            const id = args?.[0];
            if (!storage.removeBanner || isExempt(id)) return url;
            return null;
          }))
        );
      }

      // --- Generic sweep: catches whatever accessor the per-server popout
      // actually uses, even if its exact method name isn't one of the above ---

      const allStoreNames = [
        "UserStore",
        "UserProfileStore",
        "GuildMemberProfileStore",
        "GuildMemberStore",
        "GuildStore",
      ];

      allStoreNames.forEach((name) => {
        const store = findByStoreName(name);
        if (!store) return;

        const proto = Object.getPrototypeOf(store);
        const methodNames = Object.getOwnPropertyNames(proto).filter(
          (k) =>
            typeof store[k] === "function" &&
            /banner/i.test(k) &&
            !/^(set|update|_)/i.test(k)
        );

        methodNames.forEach((methodName) => {
          patches.push(
            after(methodName, store, safe((args, res) => {
              if (!res) return res;
              const id = idFromArgs(args, res);
              if (!storage.removeBanner || isExempt(id)) return res;

              // If it returns a URL/string directly, just null it out
              if (typeof res === "string") return null;

              // Otherwise treat it as an object/record and strip banner fields
              let next = applyBannerState(res, id);

              if (next?.user) next.user = applyBannerState(next.user, id);
              if (next?.guildMemberProfile) {
                next.guildMemberProfile = applyBannerState(next.guildMemberProfile, id);
              }
              return next;
            }))
          );
        });
      });

      const bannerPropsSweep = findByProps("getUserBannerURL", "getUserAvatarURL");
      if (bannerPropsSweep) {
        Object.keys(bannerPropsSweep)
          .filter((k) => typeof bannerPropsSweep[k] === "function" && /banner/i.test(k))
          .forEach((fnName) => {
            patches.push(
              after(fnName, bannerPropsSweep, safe((args, url) => {
                if (!url) return url;
                const id = args?.[0]?.id ?? args?.[0] ?? args?.[1]?.id ?? args?.[1];
                if (!storage.removeBanner || isExempt(id)) return url;
                return typeof url === "string" ? null : url;
              }))
            );
          });
      }
    };

    applyPatches();
  },
  onUnload() {
    patches.forEach((p) => p?.());
  },
  settings: Settings,
};
