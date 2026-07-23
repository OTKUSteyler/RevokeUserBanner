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

const safe = (fn) => (...args) => {
  try {
    return fn(...args);
  } catch {
    return undefined;
  }
};

function Settings() {
  const [, forceUpdate] = React.useReducer((x) => x + 1, 0);
  const [input, setInput] = React.useState("");
  const { FormSwitchRow, FormInput, FormRow, FormSection, FormDivider } = Forms;
  const { View } = ReactNative;
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
        subLabel: "Strips banners from users everywhere",
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
    const load = () => {
      unloadPatches();
      patches = [];

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
    };
    load();
  },
  onUnload() {
    patches.forEach((p) => p?.());
  },
  settings: Settings,
};
