import { useEffect, useState } from 'react';
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';
import { db } from '../../../firebase';
import { useUser } from '../../../contexts/UserContext';

export const useCategories = ({ enabled = true } = {}) => {
    const { classId } = useUser();
    const [categories, setCategories] = useState([]);

    useEffect(() => {
        if (!enabled || !classId) return undefined;
        const ref = collection(db, 'classes', classId, 'marketplace_categories');
        const q = query(ref, orderBy('order', 'asc'));
        return onSnapshot(q, (snap) => {
            setCategories(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        });
    }, [classId, enabled]);

    return { categories };
};
