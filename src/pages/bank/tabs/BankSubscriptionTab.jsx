import { appAlert, appConfirm } from "../../../utils/appDialogs";
import React, { useEffect, useState } from "react";
import { ExclamationTriangleIcon } from "@heroicons/react/24/outline";

import { Card, Spinner } from "../../../components/ui";
import { useUser } from "../../../contexts/UserContext";
import { useBank } from "../../../contexts/BankContext";
import useSubscription from "../../../hooks/bank/useSubscription";
import SubscriptionProductListItem from "../components/SubscriptionProductListItem";
import SubscriptionProductDetailPanel from "../components/SubscriptionProductDetailPanel";
import { useLotteryRounds } from "../hooks/subscription/useLotteryQueries";
import { useSubscriptionMutations } from "../hooks/subscription/useSubscriptionMutations";
import LotteryModal from "../modals/subscription/LotteryModal";
import SubscriptionHistoryModal from "../modals/subscription/SubscriptionHistoryModal";
import SubscriptionPaymentModal from "../modals/subscription/SubscriptionPaymentModal";

const BankSubscriptionTab = ({ uid, classId, onOpenResultModal }) => {
  const {
    currencyUnit,
    studentProfile,
    myParticipations = {},
    isLoading: bankLoading,
  } = useBank();

  const { isTeacher, isAdmin } = useUser();
  const userRole = isTeacher || isAdmin ? "teacher" : "student";
  const {
    products = [],
    isLoading: subscriptionProductsLoading,
  } = useSubscription(classId, uid, userRole, {
    includeProducts: true,
    includeParticipations: false,
    participationsOverride: myParticipations,
  });

  const [selectedProductId, setSelectedProductId] = useState(null);
  const [showLotteryModal, setShowLotteryModal] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [selectedModalProduct, setSelectedModalProduct] = useState(null);
  const [isSubmittingPayment, setIsSubmittingPayment] = useState(false);

  useEffect(() => {
    if (!products?.length) {
      if (selectedProductId) setSelectedProductId(null);
      return;
    }

    const hasSelected = products.some((product) => product.id === selectedProductId);
    if (!selectedProductId || !hasSelected) {
      setSelectedProductId(products[0].id);
    }
  }, [products, selectedProductId]);

  const { data: rounds = [], isLoading: roundsLoading } = useLotteryRounds(classId, selectedProductId);
  const currentRound = rounds.find((round) => round.status === "scheduled" || round.status === "running");

  const {
    payMutation,
    withdrawMutation,
    terminateMutation,
  } = useSubscriptionMutations(classId, uid);

  const payPending = payMutation.isPending ?? payMutation.isLoading ?? false;
  const withdrawPending = withdrawMutation.isPending ?? withdrawMutation.isLoading ?? false;
  const terminatePending = terminateMutation.isPending ?? terminateMutation.isLoading ?? false;
  const isLoading = bankLoading || subscriptionProductsLoading || roundsLoading;

  const handleOpenPayment = (product) => {
    setSelectedModalProduct(product);
    setShowPaymentModal(true);
    setIsSubmittingPayment(false);
  };

  const handleOpenHistory = (product) => {
    setSelectedModalProduct(product);
    setShowHistoryModal(true);
  };

  const getActiveParticipation = (productId) => {
    const participation = myParticipations[productId];
    if (!participation || participation.isWithdrawn || participation.isTerminated) {
      return null;
    }
    return participation;
  };

  const handleConfirmPayment = async (amount) => {
    if (!selectedModalProduct || isSubmittingPayment || payPending) return;

    setIsSubmittingPayment(true);
    try {
      await payMutation.mutateAsync({ productId: selectedModalProduct.id, amount });
      setShowPaymentModal(false);
    } finally {
      setIsSubmittingPayment(false);
    }
  };

  const handleTerminate = async (product) => {
    if (product?.earlyTerminationBlocked === true) {
      appAlert("이 상품은 만기 전 중도해지가 제한되어 있습니다.");
      return;
    }

    const confirmed = (await appConfirm(
      `"${product.title}" 청약을 해지할까요?\n지금까지 납입한 금액에 대한 이자를 함께 지급하고, 해지 시 청약 가점은 사라집니다.`,
    ));
    if (!confirmed) return;

    await terminateMutation.mutateAsync({ productId: product.id, studentUid: uid });
  };

  if (isLoading && products.length === 0) {
    return (
      <div className="flex min-h-[300px] items-center justify-center">
        <Spinner title="청약 정보를 불러오는 중..." />
      </div>
    );
  }

  if (products.length === 0) {
    return (
      <Card title="청약통장 서비스" icon={ExclamationTriangleIcon} titleColor="text-yellow-600">
        <div className="py-12 text-center">
          <p className="font-medium text-gray-500">현재 운영 중인 청약 상품이 없습니다.</p>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-[minmax(300px,0.36fr)_minmax(0,0.64fr)]">
        <section data-tour="bank-subscription-products" className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-5 py-5 sm:px-6">
            <h2 className="text-lg font-black text-slate-900">청약 상품</h2>
            <p className="mt-1 text-sm font-medium text-slate-500">
              상품을 선택해 납입과 추첨 현황을 확인하세요.
            </p>
          </div>
          <div>
            {products.map((product, index) => (
              <SubscriptionProductListItem
                key={product.id}
                product={product}
                participation={getActiveParticipation(product.id)}
                isOpen={selectedProductId === product.id}
                isLast={index === products.length - 1}
                showDetail={false}
                userRole={userRole}
                currencyUnit={currencyUnit}
                currentRound={selectedProductId === product.id ? currentRound : null}
                onSelect={() => setSelectedProductId(product.id)}
              />
            ))}
          </div>
        </section>

        <SubscriptionProductDetailPanel
          product={products.find((product) => product.id === selectedProductId)}
          participation={getActiveParticipation(selectedProductId)}
          userRole={userRole}
          currencyUnit={currencyUnit}
          currentRound={currentRound}
          onOpenDepositModal={() => {
            const product = products.find((item) => item.id === selectedProductId);
            if (product) handleOpenPayment(product);
          }}
          onOpenHistoryModal={() => {
            const product = products.find((item) => item.id === selectedProductId);
            if (product) handleOpenHistory(product);
          }}
          onOpenLotteryModal={() => setShowLotteryModal(true)}
          onWithdraw={() => withdrawMutation.mutate({ productId: selectedProductId, studentUid: uid })}
          onTerminate={() => {
            const product = products.find((item) => item.id === selectedProductId);
            if (product) handleTerminate(product);
          }}
          isSubmitting={withdrawPending || terminatePending}
        />
      </div>

      <SubscriptionPaymentModal
        isOpen={showPaymentModal}
        onClose={() => setShowPaymentModal(false)}
        product={selectedModalProduct}
        participation={selectedModalProduct ? getActiveParticipation(selectedModalProduct.id) : null}
        currencyUnit={currencyUnit}
        studentAssets={studentProfile?.assets}
        onConfirm={handleConfirmPayment}
        isSubmitting={isSubmittingPayment || payPending}
        currentRound={currentRound}
      />

      <SubscriptionHistoryModal
        isOpen={showHistoryModal}
        onClose={() => setShowHistoryModal(false)}
        uid={uid}
        classId={classId}
        productId={selectedModalProduct?.id}
        productTitle={selectedModalProduct?.title}
        currencyUnit={currencyUnit}
        initialPaymentHistory={
          selectedModalProduct
            ? myParticipations[selectedModalProduct.id]?.paymentHistory || []
            : []
        }
      />

      <LotteryModal
        isOpen={showLotteryModal}
        onClose={() => setShowLotteryModal(false)}
        product={products.find((product) => product.id === selectedProductId)}
        classId={classId}
        currencyUnit={currencyUnit}
      />

      {(withdrawPending || terminatePending) ? (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="rounded-2xl bg-white p-8 text-center shadow-2xl">
            <Spinner className="mb-4 h-10 w-10 border-indigo-600" />
            <p className="text-xl font-bold text-slate-800">
              {terminatePending ? "청약 해지 중…" : "청약금 수령 중..."}
            </p>
            <p className="mt-2 text-slate-500">
              {terminatePending
                ? "납입 원금과 지금까지의 이자를 계산하고 있어요."
                : "청약 원금과 이자를 계산하고 있어요."}
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default BankSubscriptionTab;
