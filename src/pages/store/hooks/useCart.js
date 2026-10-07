import { useState, useEffect } from "react";
import { db } from "../../../firebase";
import {
  doc,
  onSnapshot,
  setDoc,
  deleteDoc,
} from "firebase/firestore";
import { useUser } from "../../../contexts/UserContext";
import { beginFirestoreSubscriptionDebug } from "../../../utils/firestoreSubscriptionDebug";

const useCart = () => {
  const { classId, userData, isTeacher } = useUser();
  const [cartItems, setCartItems] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  // 1️⃣ 실시간 구독: DB에 저장된 장바구니 가져오기
  useEffect(() => {
    if (!classId || !userData?.uid) return;

    const cartRef = doc(
      db,
      `classes/${classId}/students/${userData.uid}/cart`,
      "current",
    );
    const subscriptionDebug = beginFirestoreSubscriptionDebug({
      source: "Store.cart",
      pathKey: "classes/{classId}/students/{uid}/cart/current",
      classId,
      role: isTeacher ? "teacher" : "student",
    });

    const unsubscribe = onSnapshot(cartRef, (snap) => {
      subscriptionDebug.recordSnapshot(snap);
      if (snap.exists()) {
        setCartItems(snap.data().items || []);
      } else {
        setCartItems([]);
      }
      setIsLoading(false);
    });

    return () => {
      unsubscribe();
      subscriptionDebug.stop();
    };
  }, [classId, isTeacher, userData?.uid]);

  // 2️⃣ 장바구니 담기 / 수량 수정 (DB 업데이트)
  const updateCartInDB = async (newItems) => {
    if (!classId || !userData?.uid) return;
    const cartRef = doc(
      db,
      `classes/${classId}/students/${userData.uid}/cart`,
      "current",
    );

    await setDoc(
      cartRef,
      {
        items: newItems,
        updatedAt: new Date(),
      },
      { merge: true },
    );
  };

  const addToCart = async (item, quantity = 1) => {
    const qty = Math.max(1, Number(quantity) || 1);
    const existing = cartItems.find((i) => i.id === item.id);
    let newItems;
    if (existing) {
      newItems = cartItems.map((i) =>
        i.id === item.id ? { ...i, quantity: i.quantity + qty } : i,
      );
    } else {
      newItems = [...cartItems, { ...item, quantity: qty }];
    }
    await updateCartInDB(newItems);
  };

  const updateQty = async (itemId, quantity) => {
    const newItems = cartItems.map((i) =>
      i.id === itemId ? { ...i, quantity } : i,
    );
    await updateCartInDB(newItems);
  };

  const removeItem = async (itemId) => {
    const newItems = cartItems.filter((i) => i.id !== itemId);
    await updateCartInDB(newItems);
  };

  const clearCart = async () => {
    const cartRef = doc(
      db,
      `classes/${classId}/students/${userData.uid}/cart`,
      "current",
    );
    await deleteDoc(cartRef);
  };

  return { cartItems, addToCart, updateQty, removeItem, clearCart, isLoading };
};

export default useCart;
