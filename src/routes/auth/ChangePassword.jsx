// src/routes/auth/ChangePassword.jsx
import { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { updatePassword, signOut, EmailAuthProvider, reauthenticateWithCredential } from 'firebase/auth';
// Firebase 임포트 경로 수정 (src 폴더 내 firebase.js를 가정)
// 만약 firebase.js가 src/firebase.js 라면, src/routes/auth/에서는 ../../firebase 가 됩니다.
// 만약 firebase.js가 src/config/firebase.js 라면, ../../../config/firebase 가 됩니다.
// 사용자님의 프로젝트 구조에 맞게 정확히 수정해주세요.
import { auth, db } from '../../firebase'; 
import { doc, updateDoc, getDoc, deleteField, serverTimestamp } from "firebase/firestore";
import { LockKeyhole, CheckCircle, XCircle, LogOut } from 'lucide-react';
import { Button as UiButton, PageLoader } from '../../components/ui';

// --- UI 컴포넌트 (이전과 동일) ---
function InputField({ id, label, type, value, onChange, placeholder, autoComplete, className = '' }) {
    return (
        <div>
            {label && <label htmlFor={id} className="block text-sm font-medium text-slate-700 mb-1">{label}</label>}
            <input
                id={id}
                name={id}
                type={type}
                placeholder={placeholder}
                value={value}
                onChange={onChange}
                autoComplete={autoComplete || id}
                className={`w-full px-3 py-2.5 border border-slate-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-colors ${className}`}
            />
        </div>
    );
}

function Button({
    onClick,
    disabled,
    children,
    className = '',
    type = "button",
    icon: Icon,
    isLoading = false,
    loadingText = "",
    tone = "indigo",
}) {
    return (
        <UiButton
            type={type}
            onClick={onClick}
            disabled={disabled}
            icon={Icon}
            isLoading={isLoading}
            loadingText={loadingText}
            tone={tone}
            size="md"
            rounded="lg"
            fullWidth
            className={`py-2.5 shadow-md hover:shadow-lg ${className}`}
        >
            {children}
        </UiButton>
    );
}

function Alert({ message, type, onAction, actionText }) {
    if (!message) return null;
    const bgColor = type === "success" ? "bg-green-50" : "bg-red-50"; // error 또는 success만 가정
    const textColor = type === "success" ? "text-green-700" : "text-red-700";
    const IconElement = type === "success" ? CheckCircle : XCircle;

    return (
        <div className={`mt-5 p-3 rounded-md text-sm flex flex-col gap-2 ${bgColor} ${textColor}`}>
            <div className="flex items-center gap-2">
                <IconElement className="h-5 w-5 flex-shrink-0" />
                <p className="flex-grow">{message}</p>
            </div>
            {onAction && actionText && (
                <UiButton
                    variant="ghost"
                    kind="ghost"
                    size="sm"
                    onClick={onAction}
                    className="mt-1 self-start hover:underline"
                >
                    {actionText}
                </UiButton>
            )}
        </div>
    );
}
// --- UI 컴포넌트 끝 ---

export default function ChangePassword() {
    const [currentPassword, setCurrentPassword] = useState("");
    const [newPassword, setNewPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [message, setMessage] = useState({ text: "", type: "", errorCode: null });
    const [isProcessing, setIsProcessing] = useState(false);
    const [authChecked, setAuthChecked] = useState(false); // 초기 사용자 확인 여부
    const [isForcedPasswordChange, setIsForcedPasswordChange] = useState(null);
    const navigate = useNavigate();
    const location = useLocation();
    const cancelPath = isForcedPasswordChange === false && location.state?.returnTo === "/account"
        ? "/account"
        : "/";

    console.log("ChangePassword RENDER: isProcessing is", isProcessing);

    useEffect(() => {
        const user = auth.currentUser;
        if (!user) {
            console.log("useEffect: No user, navigating to login.");
            navigate("/login");
        } else {
            // 강제 변경 플래그 확인 로직 (선택적 유지 또는 App.jsx에서 처리)
            const checkFlag = async () => {
                try {
                    const userDocRef = doc(db, "users", user.uid);
                    const userDocSnap = await getDoc(userDocRef);
                    setIsForcedPasswordChange(userDocSnap.exists() ? userDocSnap.data().forcePasswordChange === true : null);
                    if (userDocSnap.exists() && userDocSnap.data().forcePasswordChange === false) {
                        console.log("useEffect: Password already changed (flag is false), navigating to home.");
                        navigate("/"); // 이미 변경된 경우 홈으로 (일반 비밀번호 변경 메뉴에서 온 경우)
                    } else {
                        console.log("useEffect: Ready to change password (or force change).");
                    }
                } catch (error) {
                    console.error("useEffect: 사용자 문서 확인 중 오류:", error);
                    setMessage({ text: "사용자 정보를 확인 중 오류가 발생했습니다.", type: "error", errorCode: error.code });
                } finally {
                    setAuthChecked(true);
                }
            };
            checkFlag();
        }
    }, [navigate]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        console.log("handleSubmit: Form submitted.");
        const user = auth.currentUser;

        if (!user) {
            setMessage({ text: "❌ 먼저 로그인해주세요.", type: "error" });
            navigate("/login");
            return;
        }
        if (!currentPassword) {
            setMessage({ text: "❗ 현재 비밀번호를 입력해주세요.", type: "error" });
            return;
        }
        if (newPassword.length < 6) {
            setMessage({ text: "❗ 새 비밀번호는 6자리 이상이어야 합니다.", type: "error" });
            return;
        }
        if (newPassword !== confirmPassword) {
            setMessage({ text: "❗ 새 비밀번호와 확인 비밀번호가 일치하지 않습니다.", type: "error" });
            return;
        }

        setIsProcessing(true);
        setMessage({ text: "", type: "" }); // 이전 메시지 초기화

        try {
            // 1. 현재 비밀번호로 재인증
            console.log("handleSubmit: Attempting to reauthenticate.");
            const credential = EmailAuthProvider.credential(user.email, currentPassword);
            await reauthenticateWithCredential(user, credential);
            console.log("handleSubmit: Reauthentication successful.");

            // 2. 새 비밀번호로 업데이트
            console.log("handleSubmit: Attempting to update password.");
            await updatePassword(user, newPassword);
            console.log("handleSubmit: updatePassword successful.");

            // 3. Firestore의 forcePasswordChange 플래그 업데이트 (필요시)
            try {
                const userDocRef = doc(db, "users", user.uid);
                const userDocSnap = await getDoc(userDocRef); // 최신 상태 확인
                if (userDocSnap.exists() && userDocSnap.data().forcePasswordChange === true) {
                    await updateDoc(userDocRef, {
                        forcePasswordChange: deleteField(), // 또는 false로 설정
                        passwordLastChangedAt: serverTimestamp()
                    });
                    console.log(`handleSubmit: forcePasswordChange flag cleared for user: ${user.uid}`);
                } else {
                    // 일반적인 비밀번호 변경의 경우, passwordLastChangedAt만 업데이트 할 수 있음
                     await updateDoc(userDocRef, {
                        passwordLastChangedAt: serverTimestamp()
                    });
                    console.log(`handleSubmit: passwordLastChangedAt updated for user: ${user.uid}`);
                }
            } catch (firestoreError) {
                console.error("handleSubmit: Error updating Firestore document:", firestoreError);
                // 이 오류는 사용자에게 치명적이지 않을 수 있으므로, 비밀번호 변경 성공 메시지는 계속 표시 가능
            }

            setMessage({ text: "✅ 비밀번호가 성공적으로 변경되었습니다! 잠시 후 다시 로그인해주세요.", type: "success" });
            setCurrentPassword("");
            setNewPassword("");
            setConfirmPassword("");

            setTimeout(async () => {
                await signOut(auth);
                navigate("/login");
            }, 2500);

        } catch (error) {
            console.error("handleSubmit: Password change process error:", error);
            if (error.code === 'auth/wrong-password') {
                setMessage({ text: "❌ 현재 비밀번호가 올바르지 않습니다.", type: "error", errorCode: error.code });
            } else if (error.code === 'auth/weak-password') {
                setMessage({ text: "❌ 새 비밀번호가 너무 약합니다. 더 강력한 비밀번호를 사용해주세요.", type: "error", errorCode: error.code });
            } else if (error.code === 'auth/requires-recent-login') {
                // 재인증을 이미 시도했음에도 이 오류가 발생한다면, 세션이 매우 짧게 만료된 경우일 수 있음.
                // 사용자에게 다시 로그인하도록 안내.
                setMessage({ text: "❌ 보안 세션이 만료되었습니다. 다시 로그인 후 시도해주세요.", type: "error", errorCode: error.code });
                 setTimeout(async () => { await signOut(auth); navigate("/login"); }, 3000);
            }
             else {
                setMessage({ text: "❌ 비밀번호 변경 중 오류가 발생했습니다: " + (error.message || "알 수 없는 오류"), type: "error", errorCode: error.code });
            }
        } finally {
            console.log("handleSubmit: Finally block, setting isProcessing to false.");
            setIsProcessing(false);
        }
    };
    
    if (!authChecked && !auth.currentUser) { // auth.currentUser도 함께 체크하여 초기 리디렉션 방지
        return (
            <PageLoader
                message={"\uC0AC\uC6A9\uC790 \uC815\uBCF4\uB97C \uD655\uC778 \uC911\uC785\uB2C8\uB2E4..."}
                showSkeleton={false}
            />
        );
    }

    return (
        <div className="min-h-screen flex flex-col items-center justify-center bg-slate-100 px-4 py-12">
            <div className="bg-white p-6 sm:p-8 rounded-xl shadow-2xl w-full max-w-md">
                <div className="flex flex-col items-center mb-6">
                    <div className="p-3 bg-indigo-100 rounded-full mb-4">
                        <LockKeyhole className="h-10 w-10 text-indigo-600" />
                    </div>
                    <h2 className="text-2xl sm:text-3xl font-bold text-slate-800">
                        비밀번호 변경
                    </h2>
                    <p className="text-sm text-slate-600 mt-2 text-center px-2">
                        계정 보안을 위해 현재 비밀번호와 함께 새 비밀번호를 입력해주세요.
                    </p>
                </div>
                
                <form onSubmit={handleSubmit} className="space-y-5">
                    <InputField
                        id="currentPassword"
                        label="현재 비밀번호"
                        type="password"
                        placeholder="현재 사용 중인 비밀번호"
                        value={currentPassword}
                        onChange={(e) => setCurrentPassword(e.target.value)}
                        autoComplete="current-password"
                    />
                    <InputField
                        id="newPassword"
                        label="새 비밀번호"
                        type="password"
                        placeholder="새 비밀번호 (6자리 이상)"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        autoComplete="new-password"
                    />
                    <InputField
                        id="confirmPassword"
                        label="새 비밀번호 확인"
                        type="password"
                        placeholder="새 비밀번호 다시 입력"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        autoComplete="new-password"
                    />
                    <div className="pt-2">
                        <Button
                            type="submit"
                            disabled={isProcessing || !currentPassword || !newPassword || !confirmPassword}
                            icon={CheckCircle}
                            isLoading={isProcessing}
                            loadingText={"\uBCC0\uACBD \uC911..."}
                        >
                            {"\uBE44\uBC00\uBC88\uD638 \uBCC0\uACBD\uD558\uAE30"}
                        </Button>
                    </div>
                </form>

                <Alert 
                    message={message.text} 
                    type={message.type}
                    onAction={message.errorCode === 'auth/requires-recent-login' ? async () => { await signOut(auth); navigate("/login"); } : undefined}
                    actionText={message.errorCode === 'auth/requires-recent-login' ? "로그인 페이지로 이동" : undefined}
                />
                
                {message.type === "success" && !isProcessing && (
                     <div className="mt-6 text-center">
                        <Button 
                            onClick={async () => { await signOut(auth); navigate("/login"); }}
                            icon={LogOut}
                            tone="emerald"
                        >
                            로그인 페이지로 이동
                        </Button>
                    </div>
                )}
                {!message.text && !isProcessing && ( // 메시지가 없고, 처리 중이 아닐 때만 "돌아가기" 표시
                    <div className="mt-6 text-center">
                        <UiButton
                            variant="ghost"
                            kind="ghost"
                            size="sm"
                            onClick={() => navigate(cancelPath)}
                            className="hover:underline"
                        >
                            취소하고 돌아가기
                        </UiButton>
                    </div>
                )}
            </div>
        </div>
    );
}
